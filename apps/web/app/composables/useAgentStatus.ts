import { useQuery } from "@tanstack/vue-query";

/** 酒保助手是否可用（ADR-028）：部署没配模型密钥时入口全部隐藏。 */
export function useAgentStatus() {
  const api = useApi();
  const { data } = useQuery({
    queryKey: ["agent-status"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/agent/status");
      if (error) throw error;
      return data;
    },
    staleTime: 10 * 60_000,
  });
  return computed(() => data.value?.enabled === true);
}
