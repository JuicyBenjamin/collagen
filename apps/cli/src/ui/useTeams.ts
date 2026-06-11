import { useCallback, useEffect, useState } from "react";
import { authClient } from "../auth/client";

export interface Team {
  id: string;
  name: string;
}

/** All teams (= rooms) in an organization. */
export function useTeams(orgId: string) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const r = await authClient.organization.listTeams({ query: { organizationId: orgId } });
    const list = (r.data ?? []) as Team[];
    setTeams(list.map((t) => ({ id: t.id, name: t.name })));
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { teams, loading, reload };
}
