"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "../../components/admin-shell";
import { Card, Notice, SmallButton } from "../../components/ui";
import { apiRequest, formatDate, prettyJson, safeJsonParse } from "../../lib/api";
import { getSingboxTemplateById, SINGBOX_INBOUND_TEMPLATES } from "../../lib/singbox-templates";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type NodeItem = {
  id: string;
  server_id: string;
  node_token: string;
  desired_config_revision: number;
  applied_config_revision: number;
  last_apply_status: string;
  last_seen_at: string | null;
  status: string;
};

type Server = { id: string; host: string };

type ValidateResponse = {
  ok: boolean;
  singbox_present: boolean;
  validated_by: string;
};

const DEFAULT_CONFIG = '{\n  "inbounds": []\n}';

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    server_id: "",
    node_token: `node-${Math.random().toString(36).slice(2, 9)}`,
    desired_config: DEFAULT_CONFIG,
  });
  const [createTemplateId, setCreateTemplateId] = useState("vless");

  const [configJson, setConfigJson] = useState(DEFAULT_CONFIG);
  const [templateId, setTemplateId] = useState("vless");
  const [rollbackRevision, setRollbackRevision] = useState("");

  const selectedNode = useMemo(() => nodes.find((item) => item.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nodesData, serverData] = await Promise.all([
        apiRequest<NodeItem[]>("/api/v1/nodes"),
        apiRequest<Array<{ id: string; host: string }>>("/api/v1/servers"),
      ]);
      setNodes(nodesData);
      setServers(serverData);
      if (!selectedNodeId && nodesData.length) {
        setSelectedNodeId(nodesData[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load nodes");
    }
  }, [selectedNodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedNode) {
      setConfigJson(DEFAULT_CONFIG);
      setValidationMessage(null);
    }
  }, [selectedNode]);

  async function run(action: () => Promise<void>, doneMessage: string) {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(doneMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function validateConfig(rawConfig: string): Promise<ValidateResponse> {
    const payload = safeJsonParse<Record<string, unknown>>(rawConfig, {});
    return apiRequest<ValidateResponse>("/api/v1/nodes/validate-config", {
      method: "POST",
      body: JSON.stringify({
        desired_config: payload,
        engine_singbox_enabled: true,
      }),
    });
  }

  function applyTemplateToCreate() {
    const template = getSingboxTemplateById(createTemplateId);
    if (!template) return;
    setCreateForm((prev) => ({ ...prev, desired_config: prettyJson(template.config) }));
    setSuccess(`Template applied: ${template.label}`);
    setValidationMessage(null);
  }

  function applyTemplateToSelected() {
    const template = getSingboxTemplateById(templateId);
    if (!template) return;
    setConfigJson(prettyJson(template.config));
    setSuccess(`Template applied: ${template.label}`);
    setValidationMessage(null);
  }

  return (
    <AdminShell
      title="Nodes"
      subtitle="Create nodes, validate Sing-box config, push desired configs and rollback revisions"
      actions={
        <div className="flex gap-2">
          <SmallButton onClick={() => void load()}>Refresh</SmallButton>
          <SmallButton
            onClick={() =>
              void run(async () => {
                await apiRequest(`/api/v1/nodes/check-offline?offline_after_seconds=120`, { method: "POST" });
              }, "Offline check completed")
            }
          >
            Check Offline
          </SmallButton>
        </div>
      }
    >
      <Notice type="error" message={error} />
      <Notice type="success" message={success} />
      <Notice type="success" message={validationMessage} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Create Node">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="label">Server</label>
              <select className="select" value={createForm.server_id} onChange={(e) => setCreateForm({ ...createForm, server_id: e.target.value })}>
                <option value="">Select server</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.host}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Node Token</label>
              <input className="input" value={createForm.node_token} onChange={(e) => setCreateForm({ ...createForm, node_token: e.target.value })} />
            </div>
            <div>
              <label className="label">Sing-box Inbound Template</label>
              <div className="flex gap-2">
                <select className="select" value={createTemplateId} onChange={(e) => setCreateTemplateId(e.target.value)}>
                  {SINGBOX_INBOUND_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
                <button className="btn" type="button" onClick={applyTemplateToCreate}>
                  Apply Template
                </button>
              </div>
              <p className="mt-1 text-xs text-black/55">
                {getSingboxTemplateById(createTemplateId)?.description ?? ""}
              </p>
            </div>
            <div>
              <label className="label">Desired Config (JSON)</label>
              <div className="overflow-hidden rounded-lg border border-black/10">
                <MonacoEditor
                  height="320px"
                  defaultLanguage="json"
                  value={createForm.desired_config}
                  onChange={(value) => setCreateForm({ ...createForm, desired_config: value ?? "{}" })}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    automaticLayout: true,
                    tabSize: 2,
                  }}
                />
              </div>
            </div>
            <button
              className="btn"
              type="button"
              disabled={!createForm.server_id || !createForm.node_token}
              onClick={() =>
                void run(
                  async () => {
                    const check = await validateConfig(createForm.desired_config);
                    setValidationMessage(`Create config validated via ${check.validated_by}`);

                    await apiRequest("/api/v1/nodes", {
                      method: "POST",
                      body: JSON.stringify({
                        server_id: createForm.server_id,
                        node_token: createForm.node_token,
                        desired_config: safeJsonParse(createForm.desired_config, { inbounds: [] }),
                        engine_awg2_enabled: true,
                        engine_singbox_enabled: true,
                      }),
                    });
                  },
                  "Node created",
                )
              }
            >
              Create Node
            </button>
          </div>
        </Card>

        <Card title="Selected Node Config">
          {!selectedNode ? (
            <p className="text-sm text-black/55">Select node below.</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-black/10 bg-black/5 p-3 text-sm">
                <p className="font-mono text-xs">{selectedNode.id}</p>
                <p>Status: {selectedNode.status}</p>
                <p>
                  Revision: {selectedNode.applied_config_revision}/{selectedNode.desired_config_revision}
                </p>
              </div>

              <div>
                <label className="label">Sing-box Inbound Template</label>
                <div className="flex gap-2">
                  <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {SINGBOX_INBOUND_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn" type="button" onClick={applyTemplateToSelected}>
                    Apply Template
                  </button>
                </div>
                <p className="mt-1 text-xs text-black/55">{getSingboxTemplateById(templateId)?.description ?? ""}</p>
              </div>

              <div>
                <label className="label">New Desired Config (JSON)</label>
                <div className="overflow-hidden rounded-lg border border-black/10">
                  <MonacoEditor
                    height="320px"
                    defaultLanguage="json"
                    value={configJson}
                    onChange={(value) => setConfigJson(value ?? "{}")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      automaticLayout: true,
                      tabSize: 2,
                    }}
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        const check = await validateConfig(configJson);
                        setValidationMessage(`Config validated via ${check.validated_by}`);
                      }, "Validation completed")
                    }
                  >
                    Validate
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void run(
                        async () => {
                          const check = await validateConfig(configJson);
                          setValidationMessage(`Push config validated via ${check.validated_by}`);

                          await apiRequest(`/api/v1/nodes/${selectedNode.id}/desired-config`, {
                            method: "POST",
                            body: configJson,
                            headers: { "Content-Type": "application/json" },
                          });
                        },
                        "Desired config updated",
                      )
                    }
                  >
                    Push Desired Config
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Rollback To Revision (optional)</label>
                <div className="flex gap-2">
                  <input className="input" value={rollbackRevision} onChange={(e) => setRollbackRevision(e.target.value)} placeholder="latest if empty" />
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void run(
                        async () => {
                          await apiRequest(`/api/v1/nodes/${selectedNode.id}/rollback`, {
                            method: "POST",
                            body: rollbackRevision ? JSON.stringify(Number(rollbackRevision)) : "null",
                            headers: { "Content-Type": "application/json" },
                          });
                        },
                        "Rollback requested",
                      )
                    }
                  >
                    Rollback
                  </button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Node List">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Server</th>
                <th>Status</th>
                <th>Apply</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr
                  key={node.id}
                  className={`cursor-pointer ${selectedNodeId === node.id ? "bg-mango/20" : "hover:bg-black/5"}`}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <td className="font-mono text-xs">{node.id.slice(0, 10)}</td>
                  <td>{servers.find((s) => s.id === node.server_id)?.host ?? node.server_id.slice(0, 10)}</td>
                  <td>{node.status}</td>
                  <td>
                    {node.last_apply_status} ({node.applied_config_revision}/{node.desired_config_revision})
                  </td>
                  <td>{formatDate(node.last_seen_at)}</td>
                </tr>
              ))}
              {nodes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-black/50">
                    No nodes yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminShell>
  );
}
