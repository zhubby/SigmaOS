import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Container, Database, Info, LoaderCircle, Network, Plus, Trash2, X } from "lucide-react";
import type { DockerSummary } from "../../api.js";
import { getSystemNetwork, proposeDockerOperation, type NasRoot } from "../../api.js";
import { initialDockerCreateForm, dockerCreateInput, validateDockerCreateStep, type DockerCreateForm, type DockerCreateKind } from "../../lib/docker-create-form.js";

type Props = {
  kind: DockerCreateKind;
  sessionId: string;
  summary: DockerSummary;
  roots: NasRoot[];
  onClose: () => void;
  onComplete: (result: { partialSuccess: boolean; error?: string }) => void | Promise<void>;
  onError: (message: string) => void;
};

const stepKeys = ["basics", "process", "resources", "storage", "network", "review"] as const;

function useCreateText() {
  const { t } = useTranslation();
  const translate = t as (key: string, options?: Record<string, unknown>) => unknown;
  return (key: string, options?: Record<string, unknown>) => String(translate(`workspace.management.docker.create.${key}`, options));
}

export function DockerCreateDialogs({ kind, sessionId, summary, roots, onClose, onComplete, onError }: Props) {
  const createT = useCreateText();
  const [form, setForm] = useState<DockerCreateForm>(() => initialDockerCreateForm(kind));
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const title = createT(`titles.${kind}`);
  const description = createT(`descriptions.${kind}`);

  useEffect(() => {
    if (kind !== "network") return;
    void getSystemNetwork().then((network) => setInterfaces(network.interfaces.filter((item) => item.kind !== "loopback").map((item) => item.name))).catch(() => setInterfaces([]));
  }, [kind]);

  useEffect(() => {
    if (submitting) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  const update = <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const canSubmit = Boolean(summary.enabled && summary.engine.status === "ready" && !submitting);
  const validation = useMemo(() => validateDockerCreateStep(step, form), [step, form]);

  function addRow<K extends "environment" | "labels" | "extraHosts" | "ipam" | "ports" | "mounts">(key: K) {
    if (key === "environment" || key === "labels") update(key, [...(form[key] as Array<{ key: string; value: string }>), { key: "", value: "" }] as DockerCreateForm[K]);
    if (key === "extraHosts") update(key, [...(form[key] as DockerCreateForm["extraHosts"]), { hostname: "", address: "" }] as DockerCreateForm[K]);
    if (key === "ipam") update(key, [...(form[key] as DockerCreateForm["ipam"]), { subnet: "", ipRange: "", gateway: "", auxAddresses: "" }] as DockerCreateForm[K]);
    if (key === "ports") update(key, [...(form[key] as DockerCreateForm["ports"]), { containerPort: "", protocol: "tcp", hostIp: "", hostPort: "" }] as DockerCreateForm[K]);
    if (key === "mounts") update(key, [...(form[key] as DockerCreateForm["mounts"]), { type: "volume", source: "", rootId: roots[0]?.id ?? "", target: "", readOnly: false, noCopy: false, sizeBytes: "", mode: "" }] as DockerCreateForm[K]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const issue = validateDockerCreateStep(6, form);
    if (issue) { setError(issue); return; }
    setSubmitting(true); setError(null);
    try {
      const response = await proposeDockerOperation({ sessionId, action: "create", ...dockerCreateInput(form) });
      if (response.result?.partialSuccess) {
        await onComplete(response.result.error ? { partialSuccess: true, error: response.result.error } : { partialSuccess: true });
      } else {
        await onComplete({ partialSuccess: false });
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message); onError(message);
    } finally { setSubmitting(false); }
  }

  function advance() {
    const issue = validateDockerCreateStep(step, form);
    if (issue) { setError(issue); return; }
    setError(null); setStep((current) => Math.min(6, current + 1));
  }

  return (
    <div className="management-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) onClose(); }}>
      <form className="management-dialog vm-create-dialog docker-create-dialog" onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="docker-create-title">
        <header className="vm-create-dialog-header">
          <div className="vm-create-heading"><span className="vm-create-icon" aria-hidden="true">{kind === "container" ? <Container size={19} /> : kind === "volume" ? <Database size={19} /> : <Network size={19} />}</span><div><span className="eyebrow">{createT("eyebrow")}</span><h3 id="docker-create-title">{title}</h3><p>{description}</p></div></div>
          <button type="button" className="management-icon-action" onClick={onClose} disabled={submitting} title={createT("actions.close")} aria-label={createT("actions.close")}><X aria-hidden="true" size={16} /></button>
        </header>
        <div className="vm-create-dialog-body">
          {kind === "container" ? <nav className="vm-create-stepper docker-create-stepper" aria-label={createT("stages.aria")}>{stepKeys.map((key, index) => <button key={key} type="button" data-state={step === index + 1 ? "current" : step > index + 1 ? "complete" : "pending"} onClick={() => index + 1 <= step && setStep(index + 1)} disabled={submitting || index + 1 > step}><span>{index + 1}</span><strong>{createT(`stages.${key}`)}</strong></button>)}</nav> : null}
          {kind === "volume" ? <VolumeStage form={form} update={update} /> : null}
          {kind === "network" ? <NetworkStage form={form} update={update} interfaces={interfaces} onAdd={() => addRow("ipam")} /> : null}
          {kind === "container" && step === 1 ? <ContainerBasics form={form} update={update} /> : null}
          {kind === "container" && step === 2 ? <ContainerProcess form={form} update={update} onAdd={addRow} /> : null}
          {kind === "container" && step === 3 ? <ContainerResources form={form} update={update} /> : null}
          {kind === "container" && step === 4 ? <ContainerStorage form={form} update={update} roots={roots} summary={summary} onAdd={addRow} /> : null}
          {kind === "container" && step === 5 ? <ContainerNetwork form={form} update={update} summary={summary} onAdd={addRow} /> : null}
          {kind === "container" && step === 6 ? <ContainerReview form={form} /> : null}
          {error || validation ? <p className="vm-create-error" role="alert"><CircleAlert size={14} />{error ?? validation}</p> : null}
        </div>
        <footer className="vm-create-dialog-footer"><span>{kind === "container" ? `${step} / 6` : createT("actions.directCreate")} · {form.name || createT("actions.unnamed")}</span><div><button type="button" onClick={onClose} disabled={submitting}>{createT("actions.cancel")}</button>{kind === "container" && step > 1 ? <button type="button" onClick={() => setStep((current) => current - 1)} disabled={submitting}>{createT("actions.back")}</button> : null}{kind === "container" && step < 6 ? <button type="button" className="vm-create-submit" onClick={advance} disabled={submitting}>{createT("actions.next")}</button> : <button type="submit" className="vm-create-submit" disabled={!canSubmit}>{submitting ? <><LoaderCircle className="spin" size={14} />{createT("actions.creating")}</> : createT("actions.createNow")}</button>}</div></footer>
      </form>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="vm-create-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="vm-create-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong></span></label>; }
function RowButton({ onClick, label }: { onClick: () => void; label?: string }) { const t = useCreateText(); const text = label ?? t("actions.remove"); return <button type="button" className="management-icon-action is-danger" onClick={onClick} title={text} aria-label={text}><Trash2 size={13} /></button>; }
function AddButton({ onClick, label }: { onClick: () => void; label?: string }) { const t = useCreateText(); return <button type="button" className="docker-create-add" onClick={onClick}><Plus size={13} />{label ?? t("actions.addRow")}</button>; }

function ContainerBasics({ form, update }: { form: DockerCreateForm; update: <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => void }) {
  const t = useCreateText();
  return <section className="vm-create-section vm-create-stage"><Heading number="01" title={t("stages.basics")} detail={t("basics.detail")} /><div className="vm-create-field-grid"><Field label={t("basics.name")}><input value={form.name} onChange={(event) => update("name", event.target.value)} autoFocus /></Field><Field label={t("basics.image")} hint={t("basics.imageHint")}><input value={form.image} onChange={(event) => update("image", event.target.value)} placeholder="ghcr.io/example/app:latest" /></Field><Field label={t("basics.platform")}><input value={form.platform} onChange={(event) => update("platform", event.target.value)} placeholder="linux/amd64" /></Field><Field label={t("basics.pullPolicy")}><select value={form.pullPolicy} onChange={(event) => update("pullPolicy", event.target.value as DockerCreateForm["pullPolicy"])}><option value="missing">{t("basics.onlyMissing")}</option><option value="always">{t("basics.alwaysPull")}</option><option value="never">{t("basics.neverPull")}</option></select></Field></div><div className="vm-create-toggle-grid"><Toggle label={t("basics.start")} checked={form.start} onChange={(value) => update("start", value)} /></div></section>;
}
function ContainerProcess({ form, update, onAdd }: { form: DockerCreateForm; update: <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => void; onAdd: (key: "environment" | "labels") => void }) {
  const t = useCreateText();
  return <section className="vm-create-section vm-create-stage"><Heading number="02" title={t("stages.process")} detail={t("process.detail")} /><div className="vm-create-field-grid"><Field label={t("process.hostname")}><input value={form.hostname} onChange={(event) => update("hostname", event.target.value)} /></Field><Field label={t("process.user")}><input value={form.user} onChange={(event) => update("user", event.target.value)} placeholder="1000:1000" /></Field><Field label={t("process.workingDir")}><input value={form.workingDir} onChange={(event) => update("workingDir", event.target.value)} placeholder="/app" /></Field><Field label={t("process.stopSignal")}><input value={form.stopSignal} onChange={(event) => update("stopSignal", event.target.value)} placeholder="SIGTERM" /></Field><Field label={t("process.stopTimeout")}><input type="number" min="0" max="86400" value={form.stopTimeoutSeconds} onChange={(event) => update("stopTimeoutSeconds", event.target.value)} /></Field></div><div className="vm-create-field-grid vm-create-field-grid-two"><Field label={t("process.entrypoint")}><input value={form.entrypoint} onChange={(event) => update("entrypoint", event.target.value)} placeholder="/bin/sh -c" /></Field><Field label={t("process.command")}><input value={form.command} onChange={(event) => update("command", event.target.value)} placeholder="npm start" /></Field></div><DynamicMap title={t("process.environment")} rows={form.environment} onChange={(rows) => update("environment", rows)} onAdd={() => onAdd("environment")} /><DynamicMap title={t("process.labels")} rows={form.labels} onChange={(rows) => update("labels", rows)} onAdd={() => onAdd("labels")} /><div className="vm-create-toggle-grid"><Toggle label={t("process.tty")} checked={form.tty} onChange={(value) => update("tty", value)} /><Toggle label={t("process.openStdin")} checked={form.openStdin} onChange={(value) => update("openStdin", value)} /><Toggle label={t("process.init")} checked={form.init} onChange={(value) => update("init", value)} /></div></section>;
}
function ContainerResources({ form, update }: { form: DockerCreateForm; update: <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => void }) {
  const t = useCreateText();
  return <section className="vm-create-section vm-create-stage"><Heading number="03" title={t("stages.resources")} detail={t("resources.detail")} /><div className="vm-create-field-grid"><Field label={t("resources.cpuLimit")}><input type="number" min="0.01" step="0.01" value={form.cpuLimit} onChange={(event) => update("cpuLimit", event.target.value)} placeholder="2" /></Field><Field label={t("resources.cpuShares")}><input type="number" min="2" max="262144" value={form.cpuShares} onChange={(event) => update("cpuShares", event.target.value)} /></Field><Field label={t("resources.cpuset")}><input value={form.cpusetCpus} onChange={(event) => update("cpusetCpus", event.target.value)} placeholder="0-3" /></Field><Field label={t("resources.memoryLimit")}><input type="number" min="4194304" value={form.memoryLimitBytes} onChange={(event) => update("memoryLimitBytes", event.target.value)} /></Field><Field label={t("resources.memoryReservation")}><input type="number" min="4194304" value={form.memoryReservationBytes} onChange={(event) => update("memoryReservationBytes", event.target.value)} /></Field><Field label={t("resources.memorySwap")}><input type="number" min="-1" value={form.memorySwapBytes} onChange={(event) => update("memorySwapBytes", event.target.value)} placeholder="-1" /></Field><Field label={t("resources.pidsLimit")}><input type="number" min="-1" max="1000000" value={form.pidsLimit} onChange={(event) => update("pidsLimit", event.target.value)} /></Field><Field label={t("resources.shmSize")}><input type="number" min="65536" value={form.shmSizeBytes} onChange={(event) => update("shmSizeBytes", event.target.value)} /></Field><Field label={t("resources.restartPolicy")}><select value={form.restartPolicy} onChange={(event) => update("restartPolicy", event.target.value as DockerCreateForm["restartPolicy"])}><option value="no">no</option><option value="always">always</option><option value="unless-stopped">unless-stopped</option><option value="on-failure">on-failure</option></select></Field>{form.restartPolicy === "on-failure" ? <Field label={t("resources.restartRetries")}><input type="number" min="0" max="1000000" value={form.restartMaxRetries} onChange={(event) => update("restartMaxRetries", event.target.value)} /></Field> : null}</div><div className="vm-create-toggle-grid"><Toggle label={t("resources.readOnlyRootfs")} checked={form.readonlyRootfs} onChange={(value) => update("readonlyRootfs", value)} /><Toggle label={t("resources.autoRemove")} checked={form.autoRemove} onChange={(value) => update("autoRemove", value)} /><Toggle label={t("resources.privileged")} checked={form.privileged} onChange={(value) => update("privileged", value)} />{form.privileged ? <Toggle label={t("resources.privilegedAck")} checked={form.privilegedAcknowledged} onChange={(value) => update("privilegedAcknowledged", value)} /> : null}</div></section>;
}

function ContainerStorage({ form, update, roots, summary, onAdd }: { form: DockerCreateForm; update: <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => void; roots: NasRoot[]; summary: DockerSummary; onAdd: (key: "mounts") => void }) {
  const t = useCreateText();
  const setMount = (index: number, patch: Partial<DockerCreateForm["mounts"][number]>) => update("mounts", form.mounts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <section className="vm-create-section vm-create-stage"><Heading number="04" title={t("stages.storage")} detail={t("storage.detail")} /><div className="docker-create-rows">{form.mounts.map((mount, index) => <div className="docker-create-row" key={index}><select value={mount.type} onChange={(event) => setMount(index, { type: event.target.value as typeof mount.type })}><option value="volume">{t("storage.volume")}</option><option value="bind">{t("storage.bind")}</option><option value="tmpfs">{t("storage.tmpfs")}</option></select>{mount.type === "bind" ? <><select value={mount.rootId} onChange={(event) => setMount(index, { rootId: event.target.value })}>{roots.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}</select><input value={mount.source} placeholder={t("storage.relativePath")} onChange={(event) => setMount(index, { source: event.target.value })} /></> : mount.type === "volume" ? <select value={mount.source} onChange={(event) => setMount(index, { source: event.target.value })}><option value="">{t("storage.selectVolume")}</option>{summary.volumes.map((volume) => <option key={volume.name} value={volume.name}>{volume.name}</option>)}</select> : <><input type="number" min="1024" value={mount.sizeBytes} placeholder={t("storage.sizeBytes")} onChange={(event) => setMount(index, { sizeBytes: event.target.value })} /><input inputMode="numeric" pattern="[0-7]{1,4}" value={mount.mode} placeholder={t("storage.tmpfsMode")} onChange={(event) => setMount(index, { mode: event.target.value })} /></>}<input value={mount.target} placeholder={t("storage.containerPath")} onChange={(event) => setMount(index, { target: event.target.value })} />{mount.type === "volume" ? <label className="docker-create-inline-check"><input type="checkbox" checked={mount.noCopy} onChange={(event) => setMount(index, { noCopy: event.target.checked })} />{t("storage.noCopy")}</label> : null}<label className="docker-create-inline-check"><input type="checkbox" checked={mount.readOnly} onChange={(event) => setMount(index, { readOnly: event.target.checked })} />{t("storage.readOnly")}</label><RowButton onClick={() => update("mounts", form.mounts.filter((_, itemIndex) => itemIndex !== index))} /></div>)}</div><AddButton onClick={() => onAdd("mounts")} label={t("storage.addMount")} /></section>;
}

function ContainerNetwork({ form, update, summary, onAdd }: { form: DockerCreateForm; update: <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => void; summary: DockerSummary; onAdd: (key: "ports" | "extraHosts") => void }) {
  const t = useCreateText();
  const setPort = (index: number, patch: Partial<DockerCreateForm["ports"][number]>) => update("ports", form.ports.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <section className="vm-create-section vm-create-stage"><Heading number="05" title={t("stages.network")} detail={t("network.detail")} /><div className="vm-create-field-grid"><Field label={t("network.mode")}><select value={form.networkMode} onChange={(event) => update("networkMode", event.target.value as DockerCreateForm["networkMode"])}><option value="bridge">bridge</option><option value="host">host</option><option value="none">none</option><option value="custom">{t("network.existingNetwork")}</option></select></Field>{form.networkMode === "custom" ? <><Field label={t("stages.network")}><select value={form.networkName} onChange={(event) => update("networkName", event.target.value)}><option value="">{t("network.selectNetwork")}</option>{summary.networks.map((network) => <option key={network.name} value={network.name}>{network.name}</option>)}</select></Field><Field label={t("network.aliases")}><input value={form.networkAliases} onChange={(event) => update("networkAliases", event.target.value)} placeholder="app,web" /></Field><Field label={t("network.staticIpv4")}><input value={form.ipv4Address} onChange={(event) => update("ipv4Address", event.target.value)} /></Field><Field label={t("network.staticIpv6")}><input value={form.ipv6Address} onChange={(event) => update("ipv6Address", event.target.value)} /></Field><Field label={t("network.endpointMac")}><input value={form.macAddress} onChange={(event) => update("macAddress", event.target.value)} /></Field></> : null}<Field label={t("network.dns")}><input value={form.dns} onChange={(event) => update("dns", event.target.value)} placeholder="1.1.1.1,8.8.8.8" /></Field><Field label={t("network.dnsSearch")}><input value={form.dnsSearch} onChange={(event) => update("dnsSearch", event.target.value)} /></Field></div><div className="docker-create-rows">{form.ports.map((port, index) => <div className="docker-create-row docker-create-port-row" key={index}><input type="number" min="1" max="65535" value={port.containerPort} placeholder={t("network.containerPort")} onChange={(event) => setPort(index, { containerPort: event.target.value })} /><select value={port.protocol} onChange={(event) => setPort(index, { protocol: event.target.value as typeof port.protocol })}><option value="tcp">tcp</option><option value="udp">udp</option><option value="sctp">sctp</option></select><input value={port.hostIp} placeholder={t("network.hostIp")} onChange={(event) => setPort(index, { hostIp: event.target.value })} /><input type="number" min="1" max="65535" value={port.hostPort} placeholder={t("network.hostPort")} onChange={(event) => setPort(index, { hostPort: event.target.value })} /><RowButton onClick={() => update("ports", form.ports.filter((_, itemIndex) => itemIndex !== index))} /></div>)}</div><AddButton onClick={() => onAdd("ports")} label={t("network.addPort")} /><DynamicHosts rows={form.extraHosts} onChange={(rows) => update("extraHosts", rows)} onAdd={() => onAdd("extraHosts")} /><div className="vm-create-toggle-grid"><Toggle label={t("network.publishAll")} checked={form.publishAllPorts} onChange={(value) => update("publishAllPorts", value)} /></div></section>;
}

function ContainerReview({ form }: { form: DockerCreateForm }) {
  const t = useCreateText();
  return <section className="vm-create-section vm-create-stage"><Heading number="06" title={t("stages.review")} detail={t("review.detail")} /><div className="vm-create-summary"><div><span>{t("basics.name")}</span><strong>{form.name || "-"}</strong></div><div><span>{t("review.image")}</span><strong>{form.image || "-"}</strong></div><div><span>{t("review.network")}</span><strong>{form.networkMode}{form.networkName ? ` · ${form.networkName}` : ""}</strong></div><div><span>{t("review.mountsPorts")}</span><strong>{form.mounts.length} / {form.ports.length}</strong></div><div><span>{t("review.start")}</span><strong>{form.start ? t("review.yes") : t("review.no")}</strong></div><div><span>{t("review.restart")}</span><strong>{form.restartPolicy}</strong></div></div><div className="vm-create-review"><Info size={16} /><div><strong>{t("review.immediate")}</strong><p>{t("review.failureDetail")}</p></div></div></section>;
}
function VolumeStage({ form, update }: { form: DockerCreateForm; update: <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => void }) {
  const t = useCreateText();
  return <section className="vm-create-section vm-create-stage"><Heading number="01" title={t("storage.volume")} detail={t("volume.detail")} /><div className="vm-create-field-grid"><Field label={t("basics.name")}><input value={form.name} onChange={(event) => update("name", event.target.value)} autoFocus /></Field></div><DynamicMap title={t("process.labels")} rows={form.labels} onChange={(rows) => update("labels", rows)} onAdd={() => update("labels", [...form.labels, { key: "", value: "" }])} /></section>;
}
function NetworkStage({ form, update, interfaces, onAdd }: { form: DockerCreateForm; update: <K extends keyof DockerCreateForm>(key: K, value: DockerCreateForm[K]) => void; interfaces: string[]; onAdd: () => void }) {
  const t = useCreateText();
  function changeDriver(driver: DockerCreateForm["driver"]) {
    update("driver", driver);
    update("driverMode", driver === "ipvlan" ? "l2" : "bridge");
  }
  return <section className="vm-create-section vm-create-stage"><Heading number="01" title={t("stages.network")} detail={t("networkCreate.detail")} /><div className="vm-create-field-grid"><Field label={t("networkCreate.name")}><input value={form.name} onChange={(event) => update("name", event.target.value)} autoFocus /></Field><Field label={t("networkCreate.driver")}><select value={form.driver} onChange={(event) => changeDriver(event.target.value as DockerCreateForm["driver"])}><option value="bridge">bridge</option><option value="macvlan">macvlan</option><option value="ipvlan">ipvlan</option></select></Field>{form.driver !== "bridge" ? <Field label={t("networkCreate.parent")}><select value={form.parent} onChange={(event) => update("parent", event.target.value)}><option value="">{t("networkCreate.selectInterface")}</option>{interfaces.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field> : null}{form.driver !== "bridge" ? <Field label={t("networkCreate.mode")}><select value={form.driverMode} onChange={(event) => update("driverMode", event.target.value)}>{form.driver === "macvlan" ? <><option value="bridge">bridge</option><option value="private">private</option><option value="vepa">vepa</option><option value="passthru">passthru</option></> : <><option value="l2">l2</option><option value="l3">l3</option><option value="l3s">l3s</option></>}</select></Field> : null}</div><div className="vm-create-toggle-grid"><Toggle label={t("networkCreate.internal")} checked={form.internal} onChange={(value) => update("internal", value)} /><Toggle label={t("networkCreate.enableIpv4")} checked={form.enableIpv4} onChange={(value) => update("enableIpv4", value)} /><Toggle label={t("networkCreate.enableIpv6")} checked={form.enableIpv6} onChange={(value) => update("enableIpv6", value)} /></div><div className="docker-create-ipam"><div className="docker-create-subheading"><h5>{t("networkCreate.ipam")}</h5><AddButton onClick={onAdd} label={t("networkCreate.addSubnet")} /></div>{form.ipam.map((entry, index) => <div className="docker-create-ipam-row" key={index}><input value={entry.subnet} placeholder={t("networkCreate.subnet")} onChange={(event) => update("ipam", form.ipam.map((item, itemIndex) => itemIndex === index ? { ...item, subnet: event.target.value } : item))} /><input value={entry.ipRange} placeholder={t("networkCreate.ipRange")} onChange={(event) => update("ipam", form.ipam.map((item, itemIndex) => itemIndex === index ? { ...item, ipRange: event.target.value } : item))} /><input value={entry.gateway} placeholder={t("networkCreate.gateway")} onChange={(event) => update("ipam", form.ipam.map((item, itemIndex) => itemIndex === index ? { ...item, gateway: event.target.value } : item))} /><input value={entry.auxAddresses} placeholder={t("networkCreate.auxAddresses")} onChange={(event) => update("ipam", form.ipam.map((item, itemIndex) => itemIndex === index ? { ...item, auxAddresses: event.target.value } : item))} /><RowButton onClick={() => update("ipam", form.ipam.filter((_, itemIndex) => itemIndex !== index))} /></div>)}</div><DynamicMap title={t("process.labels")} rows={form.labels} onChange={(rows) => update("labels", rows)} onAdd={() => update("labels", [...form.labels, { key: "", value: "" }])} /></section>;
}
function DynamicMap({ title, rows, onChange, onAdd }: { title: string; rows: Array<{ key: string; value: string }>; onChange: (rows: Array<{ key: string; value: string }>) => void; onAdd: () => void }) { const t = useCreateText(); return <div className="docker-create-map"><div className="docker-create-subheading"><h5>{title}</h5><AddButton onClick={onAdd} /></div>{rows.map((row, index) => <div className="docker-create-row" key={index}><input value={row.key} placeholder={t("common.key")} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} /><input value={row.value} placeholder={t("common.value")} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} /><RowButton onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))} /></div>)}</div>; }
function DynamicHosts({ rows, onChange, onAdd }: { rows: DockerCreateForm["extraHosts"]; onChange: (rows: DockerCreateForm["extraHosts"]) => void; onAdd: () => void }) { const t = useCreateText(); return <div className="docker-create-map"><div className="docker-create-subheading"><h5>{t("network.extraHosts")}</h5><AddButton onClick={onAdd} /></div>{rows.map((row, index) => <div className="docker-create-row" key={index}><input value={row.hostname} placeholder={t("network.hostname")} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, hostname: event.target.value } : item))} /><input value={row.address} placeholder={t("network.hostAddress")} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))} /><RowButton onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))} /></div>)}</div>; }
function Heading({ number, title, detail }: { number: string; title: string; detail: string }) { return <div className="vm-create-section-heading"><span>{number}</span><div><h4>{title}</h4><p>{detail}</p></div></div>; }
