import { beforeEach, expect, it } from "vitest"
import {
  loadEnabledAcpAgentsCache,
  saveEnabledAcpAgentsCache,
} from "@/lib/enabled-acp-agents-storage"
import type { AcpAgentInfo } from "@/lib/types"

const STORAGE_KEY = "codeg:enabled-acp-agents:v1"
let storage = new Map<string, string>()

beforeEach(() => {
  storage = new Map()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } as Partial<Storage>,
  })
})

it("caches the display-safe fields but not agent configuration or secrets", () => {
  saveEnabledAcpAgentsCache([
    {
      agent_type: "codex",
      skills_capable: true,
      registry_id: "codex-acp",
      registry_version: null,
      name: "Codex",
      description: "",
      available: true,
      distribution_type: "binary",
      is_acp_adapter: true,
      custom_source: null,
      enabled: true,
      sort_order: 0,
      installed_version: "1.0.0",
      host_tools_agent_mode: false,
      env: { API_KEY: "secret" },
      config_json: '{"token":"secret"}',
      config_file_path: "/tmp/config",
      opencode_auth_json: null,
      codex_auth_json: '{"token":"secret"}',
      codex_config_toml: "api_key = 'secret'",
      codex_model_catalog: null,
      codex_sandbox_settings: null,
      cline_secrets_json: null,
      hermes_config_yaml: null,
      grok_config_toml: null,
      grok_settings: null,
      cursor_cli_config_json: null,
      cursor_settings: null,
      model_provider_id: null,
      icon_url: null,
    } satisfies AcpAgentInfo,
  ])

  const raw = storage.get(STORAGE_KEY)
  expect(raw).not.toContain("secret")
  expect(loadEnabledAcpAgentsCache()).toMatchObject([
    {
      agent_type: "codex",
      host_tools_agent_mode: false,
      env: {},
      config_json: null,
      codex_auth_json: null,
      codex_config_toml: null,
    },
  ])
})

it("defaults missing host_tools_agent_mode on older cache entries", () => {
  storage.set(
    STORAGE_KEY,
    JSON.stringify([
      {
        agent_type: "codex",
        skills_capable: true,
        registry_id: "codex-acp",
        registry_version: null,
        name: "Codex",
        description: "",
        available: true,
        distribution_type: "binary",
        is_acp_adapter: true,
        custom_source: null,
        enabled: true,
        sort_order: 0,
        installed_version: "1.0.0",
        model_provider_id: null,
        icon_url: null,
      },
    ])
  )

  expect(loadEnabledAcpAgentsCache()).toMatchObject([
    { agent_type: "codex", host_tools_agent_mode: false },
  ])
})
