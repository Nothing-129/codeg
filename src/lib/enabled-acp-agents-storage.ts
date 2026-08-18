"use client"

import type { AcpAgentInfo } from "@/lib/types"

const STORAGE_KEY = "codeg:enabled-acp-agents:v1"

type CachedAgent = Pick<
  AcpAgentInfo,
  | "agent_type"
  | "skills_capable"
  | "registry_id"
  | "registry_version"
  | "name"
  | "description"
  | "available"
  | "distribution_type"
  | "is_acp_adapter"
  | "custom_source"
  | "enabled"
  | "sort_order"
  | "installed_version"
  | "model_provider_id"
  | "icon_url"
> & {
  // Older cache entries predate this resolved launch verdict.
  host_tools_agent_mode?: boolean
}

function toAgentInfo(agent: CachedAgent): AcpAgentInfo {
  return {
    ...agent,
    host_tools_agent_mode: agent.host_tools_agent_mode ?? false,
    env: {},
    config_json: null,
    config_file_path: null,
    opencode_auth_json: null,
    codex_auth_json: null,
    codex_config_toml: null,
    codex_model_catalog: null,
    codex_sandbox_settings: null,
    cline_secrets_json: null,
    hermes_config_yaml: null,
    grok_config_toml: null,
    grok_settings: null,
    cursor_cli_config_json: null,
    cursor_settings: null,
  }
}

function isCachedAgent(value: unknown): value is CachedAgent {
  if (!value || typeof value !== "object") return false
  const agent = value as Partial<CachedAgent>
  return (
    typeof agent.agent_type === "string" &&
    typeof agent.name === "string" &&
    typeof agent.enabled === "boolean" &&
    typeof agent.available === "boolean" &&
    typeof agent.sort_order === "number" &&
    (agent.host_tools_agent_mode === undefined ||
      typeof agent.host_tools_agent_mode === "boolean")
  )
}

/** Read the safe, presentation-only agent list saved by the chat UI. */
export function loadEnabledAcpAgentsCache(): AcpAgentInfo[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed) || !parsed.every(isCachedAgent)) return []
    return parsed.map(toAgentInfo)
  } catch {
    return []
  }
}

/** Persist only fields the chat UI renders; never cache credentials/config. */
export function saveEnabledAcpAgentsCache(agents: AcpAgentInfo[]): void {
  if (typeof window === "undefined") return
  const cached: CachedAgent[] = agents.map(
    ({
      agent_type,
      skills_capable,
      registry_id,
      registry_version,
      name,
      description,
      available,
      distribution_type,
      is_acp_adapter,
      custom_source,
      enabled,
      sort_order,
      installed_version,
      model_provider_id,
      icon_url,
      host_tools_agent_mode,
    }) => ({
      agent_type,
      skills_capable,
      registry_id,
      registry_version,
      name,
      description,
      available,
      distribution_type,
      is_acp_adapter,
      custom_source,
      enabled,
      sort_order,
      installed_version,
      model_provider_id,
      icon_url,
      host_tools_agent_mode,
    })
  )
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached))
  } catch {
    /* ignore */
  }
}
