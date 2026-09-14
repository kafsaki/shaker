// Package media 媒体预签名直传（API 定义 §2.10，ADR-015）。
//
// 三步：签发预签名 PUT（记录 pending）→ 客户端直传 MinIO → commit 确认。
// 未 commit 的记录由周期任务连对象一起清理（v1 暂无 river，先留 orphan 索引）。
// 安全边界：mime 白名单 + byteSize 上限 + key 服务端生成（客户端不能自选路径）。
package media

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kafsaki/shaker/apps/api/internal/config"
)

var (
	// ErrBadPurpose 未知用途。
	ErrBadPurpose = errors.New("未知媒体用途")
	// ErrBadMime mime 不在白名单。
	ErrBadMime = errors.New("不支持的媒体类型")
	// ErrTooLarge 超过字节上限。
	ErrTooLarge = errors.New("文件超过大小上限")
	// ErrNotFound 实体或 asset 不存在。
	ErrNotFound = errors.New("对象不存在")
	// ErrForbidden 不是实体主人（只有主人能给自己的配方/酒单/头像传媒体）。
	ErrForbidden = errors.New("只能给自己的对象上传媒体")
	// ErrNotUploaded commit 时对象存储里还没有这个 key（客户端还没直传完）。
	ErrNotUploaded = errors.New("对象尚未上传")
)

const (
	// MaxBytes 单文件上限 10MB（前端 canvas 截帧远小于此）。
	MaxBytes = 10 << 20
	// PresignTTL 预签名有效期（秒）。契约写死 900。
	PresignTTL = 15 * time.Minute
)

// purposeMeta 用途 → 目录名 + 实体表 + 归属校验方式。
type purposeMeta struct {
	dir  string // storage key 的目录前缀
	kind string // 文件名前缀（cover / avatar）
}

var purposes = map[string]purposeMeta{
	"recipe_cover": {dir: "recipes", kind: "cover"},
	"menu_cover":   {dir: "menus", kind: "cover"},
	"user_avatar":  {dir: "users", kind: "avatar"},
}

// mimeExt mime 白名单 → 扩展名。
var mimeExt = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
}

// Store 媒体数据访问 + S3 预签名。
type Store struct {
	pool      *pgxpool.Pool
	s3        *s3.Client
	presign   *s3.PresignClient
	bucket    string
	publicURL string
}

func NewStore(pool *pgxpool.Pool, cfg config.Config) *Store {
	creds := aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(
		cfg.S3AccessKey, cfg.S3SecretKey, ""))
	client := s3.New(s3.Options{
		Region:       "us-east-1", // MinIO 不校验 region，但 SigV4 要求非空
		Credentials:  creds,
		BaseEndpoint: aws.String(cfg.S3Endpoint),
		UsePathStyle: true, // MinIO 必须 path-style
	})
	return &Store{
		pool:      pool,
		s3:        client,
		presign:   s3.NewPresignClient(client),
		bucket:    cfg.S3Bucket,
		publicURL: cfg.S3PublicURL,
	}
}

// Asset 签发结果。
type Asset struct {
	ID         uuid.UUID
	StorageKey string
	UploadURL  string
	ExpiresIn  int
}

// Presign 校验归属 → 生成规范 key → 建 pending 记录 → 签 PUT URL。
func (s *Store) Presign(ctx context.Context, ownerID uuid.UUID,
	purpose string, entityID uuid.UUID, mimeType string, byteSize int64) (*Asset, error) {
	meta, ok := purposes[purpose]
	if !ok {
		return nil, ErrBadPurpose
	}
	if _, ok := mimeExt[mimeType]; !ok {
		return nil, ErrBadMime
	}
	if byteSize < 1 || byteSize > MaxBytes {
		return nil, ErrTooLarge
	}
	if err := s.assertOwner(ctx, purpose, entityID, ownerID); err != nil {
		return nil, err
	}

	// revision = 该实体已有媒体数 + 1；唯一索引冲突（并发签发）时递增重试。
	var asset *Asset
	for rev := s.nextRevision(ctx, purpose, entityID) + 1; ; rev++ {
		key := fmt.Sprintf("%s/%s/%s-%d.%s", meta.dir, entityID, meta.kind, rev, mimeExt[mimeType])
		id := uuid.Must(uuid.NewV7())
		_, err := s.pool.Exec(ctx, `
			INSERT INTO media_assets (id, storage_key, owner_id, entity_type, entity_id, mime_type, byte_size)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			id, key, ownerID, purpose, entityID, mimeType, byteSize)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				continue // revision 撞号，换下一个
			}
			return nil, fmt.Errorf("写媒体记录: %w", err)
		}
		url, err := s.presignPut(ctx, key, mimeType)
		if err != nil {
			return nil, err
		}
		asset = &Asset{ID: id, StorageKey: key, UploadURL: url, ExpiresIn: int(PresignTTL.Seconds())}
		break
	}
	return asset, nil
}

// Commit 确认直传完成：HEAD 校验对象存在 → 置 committed_at → 返回公网 URL。
// 幂等：已 commit 的 asset 直接返回 URL。
func (s *Store) Commit(ctx context.Context, ownerID, assetID uuid.UUID) (string, error) {
	var key string
	var committedAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT storage_key, committed_at FROM media_assets
		WHERE id = $1 AND owner_id = $2`, assetID, ownerID).Scan(&key, &committedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("查询媒体记录: %w", err)
	}
	if committedAt == nil {
		if _, err := s.s3.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(s.bucket), Key: aws.String(key),
		}); err != nil {
			return "", ErrNotUploaded
		}
		if _, err := s.pool.Exec(ctx,
			`UPDATE media_assets SET committed_at = now() WHERE id = $1`, assetID); err != nil {
			return "", fmt.Errorf("置 committed: %w", err)
		}
	}
	return s.publicURL + "/" + key, nil
}

// assertOwner 校验实体存在且属于 owner。头像的「实体」就是本人。
func (s *Store) assertOwner(ctx context.Context, purpose string, entityID, ownerID uuid.UUID) error {
	var sql string
	switch purpose {
	case "recipe_cover":
		sql = `SELECT EXISTS(SELECT 1 FROM recipes WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL)`
	case "menu_cover":
		sql = `SELECT EXISTS(SELECT 1 FROM menus WHERE id = $1 AND owner_id = $2)`
	case "user_avatar":
		if entityID == ownerID {
			return nil
		}
		return ErrForbidden
	default:
		return ErrBadPurpose
	}
	var ok bool
	if err := s.pool.QueryRow(ctx, sql, entityID, ownerID).Scan(&ok); err != nil {
		return fmt.Errorf("查询归属: %w", err)
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *Store) nextRevision(ctx context.Context, purpose string, entityID uuid.UUID) int {
	var n int
	// 归属失败等错误在这里不致命：revision 只是文件名，宁可跳号不可阻塞
	_ = s.pool.QueryRow(ctx,
		`SELECT count(*) FROM media_assets WHERE entity_type = $1 AND entity_id = $2`,
		purpose, entityID).Scan(&n)
	return n
}

func (s *Store) presignPut(ctx context.Context, key, mimeType string) (string, error) {
	req, err := s.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(mimeType),
	}, s3.WithPresignExpires(PresignTTL))
	if err != nil {
		return "", fmt.Errorf("签发预签名 URL: %w", err)
	}
	return req.URL, nil
}
