import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Copy,
  Cube,
  FileImage,
  FolderSimple,
  GearSix,
  Package,
  Plus,
  Sparkle,
  UploadSimple,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const DIRECTIONS = [
  {
    key: "S",
    name: "South",
    body: "asset_mur47jm9_qbkzu2x.png",
    hair: "asset_mur47mfm_rutick1.png",
    bodyId: "asset_mur47jm9_qbkzu2x",
    hairId: "asset_mur47mfm_rutick1",
  },
  {
    key: "SW",
    name: "South-West",
    body: "asset_mur47yg8_85n4dha.png",
    hair: "asset_mur480fa_px05jit.png",
    bodyId: "asset_mur47yg8_85n4dha",
    hairId: "asset_mur480fa_px05jit",
  },
  {
    key: "W",
    name: "West",
    body: "asset_mur48dfl_9uhnnaa.png",
    hair: "asset_mur48fne_527xm3k.png",
    bodyId: "asset_mur48dfl_9uhnnaa",
    hairId: "asset_mur48fne_527xm3k",
  },
  {
    key: "NW",
    name: "North-West",
    body: "asset_mur48rgq_v6av5bq.png",
    hair: "asset_mur48tt3_izqsvx6.png",
    bodyId: "asset_mur48rgq_v6av5bq",
    hairId: "asset_mur48tt3_izqsvx6",
  },
  {
    key: "N",
    name: "North",
    body: "asset_mur4963k_jvsf007.png",
    hair: "asset_mur4992e_6l8sfkx.png",
    bodyId: "asset_mur4963k_jvsf007",
    hairId: "asset_mur4992e_6l8sfkx",
  },
];

const STORAGE_KEY = "character-asset.active-workspace.v1";
const MCP_PROTOCOL = "2026-07-28";

function displayArgs(args) {
  if (!args?.image_data_url) return args;
  const bytes = Math.max(0, Math.floor((args.image_data_url.length * 3) / 4) - 2);
  return {
    ...args,
    image_data_url: `[inline PNG data omitted · ${bytes.toLocaleString()} bytes]`,
  };
}

function restEquivalent(tool, args) {
  const id = encodeURIComponent(args?.character_id ?? "{character_id}");
  const direction = encodeURIComponent(args?.direction ?? "{direction}");
  let method = "POST";
  let path = "";
  let body = args;

  switch (tool) {
    case "project.create":
      path = "/projects";
      break;
    case "character.create_spec":
      path = "/characters/specs";
      break;
    case "character.get_spec":
      method = "GET";
      path = `/characters/${id}/spec`;
      body = null;
      break;
    case "character.prepare_base_views":
      path = `/characters/${id}/base-views:prepare`;
      body = { views: args.views };
      break;
    case "character.ingest_base_view": {
      path = `/characters/${id}/base-views/${direction}:ingest`;
      const { character_id, direction: _direction, ...rest } = args;
      body = rest;
      break;
    }
    case "character.get_base_views":
      method = "GET";
      path = `/characters/${id}/base-views`;
      body = null;
      break;
    case "character.validate_base_views":
      path = `/characters/${id}/base-views:validate`;
      body = {};
      break;
    case "parts.auto_segment": {
      path = `/characters/${id}/parts:auto-segment`;
      const { character_id, ...rest } = args;
      body = rest;
      break;
    }
    case "parts.list":
      method = "GET";
      path = `/characters/${id}/parts${args.direction ? `?direction=${encodeURIComponent(args.direction)}` : ""}`;
      body = null;
      break;
    case "parts.approve":
      path = `/characters/${id}/parts/${encodeURIComponent(args.part_id)}:approve`;
      body = { approved: args.approved ?? true };
      break;
    case "rig.create": {
      path = `/characters/${id}/rig`;
      const { character_id, ...rest } = args;
      body = rest;
      break;
    }
    case "rig.get":
      method = "GET";
      path = `/characters/${id}/rig`;
      body = null;
      break;
    case "rig.auto_bind_parts": {
      path = `/characters/${id}/rig:auto-bind`;
      const { character_id, ...rest } = args;
      body = rest;
      break;
    }
    case "rig.validate":
      path = `/characters/${id}/rig:validate`;
      body = {};
      break;
    default:
      path = "/mcp";
      body = args;
  }

  return { method, path, body: body ? displayArgs(body) : null };
}

function nextTool(tool, data, succeeded, generation) {
  if (!succeeded) return "Resolve request error";
  switch (tool) {
    case "project.create":
      return "character.create_spec";
    case "character.create_spec":
    case "character.get_spec":
      return "character.prepare_base_views";
    case "character.prepare_base_views":
      return "character.ingest_base_view";
    case "character.ingest_base_view":
      return "character.get_base_views";
    case "character.get_base_views":
      return data?.views?.length >= 5
        ? "character.validate_base_views"
        : generation?.generation_id ? "character.ingest_base_view" : "character.prepare_base_views";
    case "character.validate_base_views":
      return data?.validation?.valid ? "parts.auto_segment" : "character.ingest_base_view";
    case "parts.auto_segment":
      return "parts.list";
    case "parts.list":
      return data?.parts?.some((part) => part.approved) ? "rig.create" : "parts.approve";
    case "parts.approve":
      return "rig.create";
    case "rig.create":
      return "rig.auto_bind_parts";
    case "rig.auto_bind_parts":
      return "rig.validate";
    case "rig.validate":
      return "—";
    default:
      return "—";
  }
}

function provenanceFor(data, mcpMeta) {
  if (data?.view?.provenance) return data.view.provenance;
  if (data?.generation) {
    return {
      generator: data.generation.generator,
      prompt_template_version: data.generation.prompt_template_version,
      generation_id: data.generation.generation_id,
      created_at: data.generation.created_at,
    };
  }
  if (data?.views?.length) {
    return {
      loaded_views: data.views.length,
      providers: [...new Set(data.views.map((view) => view.provenance?.provider).filter(Boolean))],
      generation_ids: [...new Set(data.views.map((view) => view.provenance?.generation_id).filter(Boolean))],
    };
  }
  return {
    transport: "MCP over local HTTP",
    server: mcpMeta?.["io.modelcontextprotocol/serverInfo"] ?? { name: "Character-Asset", version: "0.3.0" },
    protocol: mcpMeta?.["io.modelcontextprotocol/protocolVersion"] ?? MCP_PROTOCOL,
  };
}

function jsonText(value, emptyLabel = "—") {
  if (value === null || value === undefined) return emptyLabel;
  return JSON.stringify(value, null, 2);
}

function sourceUrl(file) {
  return `/assets/source/${file}`;
}

function savedImageUrl(characterId, direction) {
  return `/api/characters/${encodeURIComponent(characterId)}/base-views/${direction}/image`;
}

function partImageUrl(characterId, partId, kind = "cutout") {
  return `/api/characters/${encodeURIComponent(characterId)}/parts/${encodeURIComponent(partId)}/${kind}`;
}

function CharacterArt({ direction, imageUrl, className = "" }) {
  if (imageUrl) {
    return <img className={`saved-art ${className}`} src={imageUrl} alt={`${direction.key} ${direction.name} character view`} />;
  }
  return (
    <span className={`layered-art ${className}`} aria-label={`${direction.key} ${direction.name} source reference`}>
      <img src={sourceUrl(direction.body)} alt="" draggable="false" />
      <img src={sourceUrl(direction.hair)} alt="" draggable="false" />
    </span>
  );
}

function IconButton({ children, label, onClick, disabled = false, className = "" }) {
  return (
    <button className={`icon-button ${className}`} type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function CodePanel({ title, value, onCopy, emptyLabel }) {
  const isEmpty = value === null || value === undefined;
  return (
    <section className="inspector-section">
      <div className="inspector-section-heading">
        <h3>{title}</h3>
        {onCopy && !isEmpty && <IconButton label={`Copy ${title.toLowerCase()}`} onClick={onCopy}><Copy size={15} /></IconButton>}
      </div>
      <div className={`code-panel ${isEmpty ? "code-empty" : ""}`}>
        <span className="code-language">{isEmpty ? "" : "JSON"}</span>
        <pre>{isEmpty ? emptyLabel : jsonText(value)}</pre>
      </div>
    </section>
  );
}

function ViewCard({ direction, selected, saved, validation, imageUrl, generationReady, onSelect, onUpload }) {
  const warning = validation?.warnings?.some((message) => message.includes(` ${direction.key} `));
  const invalid = validation?.errors?.some((message) => message.includes(` ${direction.key}`));
  const status = invalid ? "Missing" : warning ? "Review" : saved ? validation?.valid ? "Valid" : "Ready" : generationReady ? "Prompt ready" : "Source ref";
  const statusIcon = invalid || warning ? <WarningCircle weight="fill" /> : saved && validation?.valid ? <CheckCircle weight="fill" /> : <FileImage />;

  return (
    <article className={`view-card ${selected ? "is-selected" : ""}`}>
      <button type="button" className="view-select" onClick={onSelect} aria-pressed={selected}>
        <span className="view-art-frame">
          <CharacterArt direction={direction} imageUrl={imageUrl} />
        </span>
        <span className="view-name"><strong>{direction.key}</strong> ({direction.name})</span>
        <span className={`view-status ${invalid || warning ? "status-warn" : saved && validation?.valid ? "status-good" : "status-muted"}`}>
          {statusIcon}<span>{status}</span>
        </span>
        <span className="view-size">128 × 128</span>
        <span className="view-source">{saved ? "stored PNG · API" : "source · body + hair"}</span>
      </button>
      <input
        id={`upload-${direction.key}`}
        className="visually-hidden"
        type="file"
        accept="image/png"
        aria-label={`Upload ${direction.key} PNG`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onUpload(direction.key, file);
          event.currentTarget.value = "";
        }}
      />
    </article>
  );
}

function App() {
  const requestCounter = useRef(0);
  const bootstrapped = useRef(false);
  const inspectorRef = useRef(null);
  const [workspace, setWorkspace] = useState(null);
  const [spec, setSpec] = useState(null);
  const [generation, setGeneration] = useState(null);
  const [storedViews, setStoredViews] = useState([]);
  const [validation, setValidation] = useState(null);
  const [parts, setParts] = useState([]);
  const [rig, setRig] = useState(null);
  const [stage, setStage] = useState("Reference");
  const [selectedDirection, setSelectedDirection] = useState("S");
  const [section, setSection] = useState("Characters");
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [baseViewsExpanded, setBaseViewsExpanded] = useState(true);
  const [componentsExpanded, setComponentsExpanded] = useState(true);
  const [inspectorTab, setInspectorTab] = useState("Inspector");
  const [call, setCall] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("Demo Project");
  const [characterName, setCharacterName] = useState("Novice Adventurer 02");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const viewsByDirection = useMemo(() => Object.fromEntries(storedViews.map((view) => [view.direction, view])), [storedViews]);
  const activeDirection = DIRECTIONS.find((view) => view.key === selectedDirection) ?? DIRECTIONS[0];
  const activeView = viewsByDirection[selectedDirection];
  const activeImage = workspace && activeView ? savedImageUrl(workspace.character_id, selectedDirection) : null;
  const promptsReady = Boolean(generation?.views?.some((view) => view.direction === selectedDirection));
  const selectedParts = useMemo(() => parts.filter((part) => part.direction === selectedDirection), [parts, selectedDirection]);
  const approvedParts = useMemo(() => parts.filter((part) => part.approved), [parts]);
  const partReadiness = useMemo(() => Object.fromEntries(DIRECTIONS.map((direction) => {
    const directional = parts.filter((part) => part.direction === direction.key);
    return [direction.key, { total: directional.length, approved: directional.filter((part) => part.approved).length }];
  })), [parts]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/health")
      .then((response) => response.ok ? response.json() : null)
      .then((health) => mounted && setOnline(health?.status === "ok"))
      .catch(() => mounted && setOnline(false));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function callTool(tool, args, activeGeneration = generation) {
    const started = performance.now();
    const request = displayArgs(args);
    const rest = restEquivalent(tool, args);
    const message = {
      jsonrpc: "2.0",
      id: String(++requestCounter.current),
      method: "tools/call",
      params: {
        name: tool,
        arguments: args,
        _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL },
      },
    };

    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": MCP_PROTOCOL,
          "mcp-method": "tools/call",
          "mcp-name": tool,
        },
        body: JSON.stringify(message),
      });
      const rpc = await response.json();
      const textContent = rpc?.result?.content?.find((item) => item.type === "text")?.text;
      let data = rpc?.result?.structuredContent;
      if (data === undefined && textContent) {
        try { data = JSON.parse(textContent); } catch { data = { text: textContent }; }
      }
      const success = response.ok && !rpc?.error && !rpc?.result?.isError && !data?.error;
      const error = rpc?.error ?? data?.error ?? null;
      const validationFailed = tool === "character.validate_base_views" && data?.validation && !data.validation.valid;
      const validationErrors = data?.validation?.errors ?? [];
      const validationWarnings = data?.validation?.warnings ?? [];
      const record = {
        tool,
        request,
        response: data ?? rpc,
        rest,
        succeeded: success,
        statusCode: response.status,
        duration: Math.max(0, Math.round(performance.now() - started)),
        errors: error ? [error] : validationErrors.map((message) => ({ message })),
        warnings: validationWarnings,
        validationFailed: Boolean(validationFailed),
        provenance: provenanceFor(data, rpc?.result?._meta),
        nextTool: nextTool(tool, data, success, activeGeneration),
        timestamp: new Date().toISOString(),
      };
      setCall(record);
      setHistory((items) => [record, ...items].slice(0, 6));
      return { data, success, record };
    } catch (error) {
      const record = {
        tool,
        request,
        response: null,
        rest,
        succeeded: false,
        statusCode: "offline",
        duration: Math.max(0, Math.round(performance.now() - started)),
        errors: [{ message: error.message || "Could not reach the local Character-Asset server" }],
        provenance: { transport: "MCP over local HTTP", server: "Character-Asset 0.3.0" },
        nextTool: "Resolve connection error",
        timestamp: new Date().toISOString(),
      };
      setCall(record);
      setHistory((items) => [record, ...items].slice(0, 6));
      return { data: null, success: false, record };
    }
  }

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"); } catch { saved = null; }
    if (!saved?.character_id) return;

    setWorkspace(saved);
    setProjectName(saved.project_name ?? "Demo Project");
    setCharacterName(saved.character_name ?? "Novice Adventurer 02");
    setGeneration(saved.generation ?? null);
    setBusy(true);
    (async () => {
      const specResult = await callTool("character.get_spec", { character_id: saved.character_id });
      if (specResult.success) setSpec(specResult.data?.spec ?? null);
      const viewsResult = await callTool("character.get_base_views", { character_id: saved.character_id }, saved.generation ?? null);
      if (viewsResult.success) setStoredViews(viewsResult.data?.views ?? []);
      const partsResult = await callTool("parts.list", { character_id: saved.character_id });
      if (partsResult.success) setParts(partsResult.data?.parts ?? []);
      const rigResult = await callTool("rig.get", { character_id: saved.character_id });
      if (rigResult.success) setRig(rigResult.data?.rig ?? null);
      setBusy(false);
    })();
  }, []);

  function saveWorkspace(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setWorkspace(next);
  }

  async function createWorkspace(event) {
    event?.preventDefault();
    const projectLabel = projectName.trim();
    const characterLabel = characterName.trim();
    if (!projectLabel || !characterLabel) {
      setFormError("Add a project and character name to continue.");
      return;
    }
    setBusy(true);
    setFormError("");
    const projectResult = await callTool("project.create", {
      name: projectLabel,
      description: "Character-Asset source-kit workspace",
    });
    if (!projectResult.success || !projectResult.data?.project) {
      setBusy(false);
      setFormError(projectResult.record.errors[0]?.message ?? "Could not create the project.");
      return;
    }
    const characterId = `char_${crypto.randomUUID().replaceAll("-", "")}`;
    const characterResult = await callTool("character.create_spec", {
      project_id: projectResult.data.project.project_id,
      character_id: characterId,
      name: characterLabel,
      style_profile: "RO-inspired 2.5D pixel RPG character",
      proportion_profile: "chibi adventurer, compact proportions",
      visual: {
        gender_presentation: "masculine",
        age_style: "young adventurer",
        silhouette: "short cloak, layered leather and cloth, small sword",
        palette: ["warm brown", "deep blue", "cream", "leather tan"],
        prompt_notes: "Keep the brown tousled hair, blue scarf, cream tunic, belt, boots, and small sword consistent in every direction.",
      },
      views_required: DIRECTIONS.map((view) => view.key),
      equipment_slots: ["head", "weapon", "shield", "back"],
      rig_preset: "biped_chibi_v1",
      motion_preset: "idle_walk_v1",
      output_constraints: {
        canvas_width: 128,
        canvas_height: 128,
        transparent_background: true,
        padding_px: 8,
      },
    });
    if (!characterResult.success || !characterResult.data?.spec) {
      setBusy(false);
      setFormError(characterResult.record.errors[0]?.message ?? "Could not create the character spec.");
      return;
    }

    const nextWorkspace = {
      project_id: projectResult.data.project.project_id,
      project_name: projectResult.data.project.name,
      character_id: characterId,
      character_name: characterResult.data.spec.name,
      generation: null,
    };
    saveWorkspace(nextWorkspace);
    setSpec(characterResult.data.spec);
    setStoredViews([]);
    setGeneration(null);
    setValidation(null);
    setParts([]);
    setRig(null);
    setStage("Reference");
    setSection("Characters");
    setSelectedDirection("S");
    setModalOpen(false);
    setBusy(false);
  }

  async function prepareViews() {
    if (!workspace) return;
    setBusy(true);
    const result = await callTool("character.prepare_base_views", {
      character_id: workspace.character_id,
      views: DIRECTIONS.map((view) => view.key),
    });
    if (result.success && result.data?.generation) {
      const nextGeneration = result.data.generation;
      setGeneration(nextGeneration);
      saveWorkspace({ ...workspace, generation: nextGeneration });
      setValidation(null);
      setNotice("Five locked prompts are ready to copy into ChatGPT image generation.");
    } else {
      setNotice(result.record.errors[0]?.message ?? "The base-view prompts could not be prepared.");
    }
    setBusy(false);
  }

  async function validateViews() {
    if (!workspace) return;
    setBusy(true);
    const result = await callTool("character.validate_base_views", { character_id: workspace.character_id });
    if (result.success && result.data?.validation) {
      setValidation(result.data.validation);
      const validationResult = result.data.validation;
      setNotice(validationResult.valid
        ? `Validated ${validationResult.views_checked} base views. Ready to extract riggable parts.`
        : `${validationResult.errors.length} required view${validationResult.errors.length === 1 ? "" : "s"} still missing.`);
    } else {
      setNotice(result.record.errors[0]?.message ?? "Validation could not be completed.");
    }
    setBusy(false);
  }

  async function extractParts(direction = selectedDirection) {
    if (!workspace || !viewsByDirection[direction]) {
      setNotice(`Store the ${direction} reference before extracting parts.`);
      return;
    }
    setBusy(true);
    const result = await callTool("parts.auto_segment", {
      character_id: workspace.character_id,
      source_direction: direction,
      part_template: "biped_chibi_parts_v1",
      mode: "hybrid",
    });
    if (result.success) {
      const list = await callTool("parts.list", { character_id: workspace.character_id });
      if (list.success) setParts(list.data?.parts ?? []);
      setStage("Parts");
      setNotice(`Extracted ${result.data?.segmentation?.parts_created ?? 17} draft parts for ${direction}. Review before approval.`);
    } else setNotice(result.record.errors[0]?.message ?? "Part extraction failed.");
    setBusy(false);
  }

  async function approvePart(part) {
    if (!workspace) return;
    setBusy(true);
    const result = await callTool("parts.approve", { character_id: workspace.character_id, part_id: part.part_id, approved: true });
    if (result.success && result.data?.part) {
      setParts((items) => items.map((item) => item.part_id === part.part_id ? result.data.part : item));
      setNotice(`${part.name} approved for rig binding.`);
    } else setNotice(result.record.errors[0]?.message ?? "Part approval failed.");
    setBusy(false);
  }

  async function createRig() {
    if (!workspace || !spec || approvedParts.length === 0) return;
    setBusy(true);
    const result = await callTool("rig.create", {
      character_id: workspace.character_id,
      rig_preset: spec.rig_preset,
      auto_bind: false,
    });
    if (result.success) {
      setRig(result.data?.rig ?? null);
      setStage("Rig");
      setNotice("Rig created. Approved parts are ready for auto bind.");
    } else setNotice(result.record.errors[0]?.message ?? "Rig creation failed.");
    setBusy(false);
  }

  async function autoBindRig() {
    if (!workspace || !rig) return;
    setBusy(true);
    const result = await callTool("rig.auto_bind_parts", { character_id: workspace.character_id });
    if (result.success) {
      setRig(result.data?.rig ?? rig);
      setNotice(`Bound ${result.data?.bound_part_ids?.length ?? 0} approved parts. ${result.data?.unmatched_bones?.length ?? 0} bones remain unmatched.`);
    } else setNotice(result.record.errors[0]?.message ?? "Auto bind failed.");
    setBusy(false);
  }

  async function uploadView(direction, file) {
    if (!workspace || !generation) {
      setNotice("Prepare base-view prompts before ingesting a generated PNG.");
      return;
    }
    if (file.type !== "image/png") {
      setNotice("Choose a PNG file so the server can validate its alpha channel and canvas size.");
      return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setNotice("The selected PNG could not be read.");
      setBusy(false);
    };
    reader.onload = async () => {
      const imageDataUrl = String(reader.result ?? "");
      const args = {
        character_id: workspace.character_id,
        direction,
        generation_id: generation.generation_id,
        image_data_url: imageDataUrl,
        provider: "chatgpt-web",
        ...(viewsByDirection[direction] ? { replace: true } : {}),
      };
      const result = await callTool("character.ingest_base_view", args);
      if (result.success && result.data?.view) {
        setStoredViews((items) => [...items.filter((item) => item.direction !== direction), result.data.view]);
        setValidation(null);
        setNotice(`${direction} PNG ingested with generation provenance.`);
      } else {
        setNotice(result.record.errors[0]?.message ?? `The ${direction} PNG could not be ingested.`);
      }
      setBusy(false);
    };
    reader.readAsDataURL(file);
  }

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(typeof value === "string" ? value : jsonText(value));
      setNotice(`${label} copied.`);
    } catch {
      setNotice("Clipboard access is unavailable in this browser.");
    }
  }

  function showInspector() {
    setInspectorTab("Inspector");
    inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const currentViewCount = storedViews.length;
  const readiness = approvedParts.length
    ? `${approvedParts.length} parts approved · Rig ready`
    : validation?.valid
      ? "Validated · Ready for parts"
      : validation
        ? `Needs view fixes · ${validation.errors.length} missing`
        : generation
          ? "Prompts prepared · 5 source references"
          : "Draft · Source references";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-name">Character-Asset</span>
          <span className="brand-version">v0.3.0</span>
        </div>
        <nav className="top-navigation" aria-label="Main navigation">
          <button aria-label="Projects" className={section === "Projects" ? "active" : ""} type="button" onClick={() => setSection("Projects")}>
            <FolderSimple size={18} weight="fill" /> <span>Projects</span>
          </button>
          <button aria-label="Characters" className={section === "Characters" ? "active" : ""} type="button" onClick={() => setSection("Characters")}>
            <UserCircle size={18} weight="fill" /> <span>Characters</span>
          </button>
          <button aria-label="Rigs" className={section === "Rigs" ? "active" : ""} type="button" onClick={() => setSection("Rigs")}>
            <GearSix size={18} weight="fill" /> <span>Rigs</span>
          </button>
        </nav>
        <div className="topbar-status">
          <span className={`connection-dot ${online ? "is-online" : ""}`} />
          <span>{online ? "MCP connected" : "MCP offline"}</span>
          <button aria-label="New workspace" className="new-workspace" type="button" onClick={() => { setModalOpen(true); setFormError(""); }}>
            <Plus size={15} weight="bold" /> <span>New workspace</span>
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar" aria-label="Project asset tree">
          <div className="sidebar-title-row">
            <h2>Projects</h2>
            <IconButton label="Create a new workspace" onClick={() => { setModalOpen(true); setFormError(""); }}>
              <Plus size={17} weight="bold" />
            </IconButton>
          </div>
          <div className="tree-content">
            <div className="tree-project">
              <button
                type="button"
                className="tree-line project-line tree-toggle"
                aria-expanded={projectExpanded}
                aria-controls="project-tree-children"
                onClick={() => setProjectExpanded((expanded) => !expanded)}
              >
                {projectExpanded ? <CaretDown size={13} weight="fill" /> : <CaretRight size={13} weight="fill" />}
                <FolderSimple size={17} weight="fill" className="tree-folder" />
                <span>{workspace?.project_name ?? "RO Original Male"}</span>
              </button>
              <div id="project-tree-children" hidden={!projectExpanded}>
                <button type="button" className="tree-line character-line is-selected" onClick={() => setSection("Characters")}>
                  <span className="tree-spacer" />
                  <span className="tree-avatar"><CharacterArt direction={DIRECTIONS[0]} /></span>
                  <span>{workspace?.character_name ?? "Novice Adventurer 02"}</span>
                </button>
                <div className="tree-nested">
                  <button
                    type="button"
                    className="tree-line folder-line tree-toggle"
                    aria-expanded={baseViewsExpanded}
                    aria-controls="base-views-tree-children"
                    onClick={() => setBaseViewsExpanded((expanded) => !expanded)}
                  >
                    {baseViewsExpanded ? <CaretDown size={13} weight="fill" /> : <CaretRight size={13} weight="fill" />}
                    <FolderSimple size={16} weight="fill" className="tree-folder" />
                    <span>Base Views</span>
                    <span className="tree-count">{currentViewCount}/5</span>
                  </button>
                  <div id="base-views-tree-children" hidden={!baseViewsExpanded}>
                    <div className="tree-directions">
                      {DIRECTIONS.map((direction) => (
                        <button
                          key={direction.key}
                          type="button"
                          className={`tree-line direction-line ${selectedDirection === direction.key && section === "Characters" ? "is-current" : ""}`}
                          onClick={() => { setSelectedDirection(direction.key); setSection("Characters"); }}
                        >
                          <span className="tree-mini-art"><CharacterArt direction={direction} imageUrl={workspace && viewsByDirection[direction.key] ? savedImageUrl(workspace.character_id, direction.key) : null} /></span>
                          <span>{direction.key} ({direction.name})</span>
                          {viewsByDirection[direction.key] && <CheckCircle className="tree-check" size={15} weight="fill" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="tree-divider" />
            <div className="tree-label">SOURCE KIT</div>
            <button
              type="button"
              className="tree-line source-folder tree-toggle"
              aria-expanded={componentsExpanded}
              aria-controls="source-kit-tree-children"
              onClick={() => setComponentsExpanded((expanded) => !expanded)}
            >
              {componentsExpanded ? <CaretDown size={13} weight="fill" /> : <CaretRight size={13} weight="fill" />}
              <FolderSimple size={16} weight="fill" className="tree-folder" />
              <span>Character components</span>
            </button>
            <div id="source-kit-tree-children" hidden={!componentsExpanded}>
              <div className="tree-line source-child"><Package size={15} /><span>body · 8 directions</span></div>
              <div className="tree-line source-child"><Package size={15} /><span>head-hair · 8 directions</span></div>
              <div className="source-caption">Editable generic export<br />Root anchor 64,108 · canvas 128²</div>
            </div>
          </div>
          <div className="sidebar-footer">
            <span className={`connection-dot ${online ? "is-online" : ""}`} />
            <span>{online ? "Local server ready" : "Waiting for local server"}</span>
            <span className="server-version">0.3.0</span>
          </div>
        </aside>

        <main className="main-panel">
          {section === "Characters" ? (
            <>
              <div className="breadcrumbs">
                <span>Projects</span><CaretRight size={12} />
                <span>{workspace?.project_name ?? "RO Original Male"}</span><CaretRight size={12} />
                <span>{workspace?.character_name ?? "Novice Adventurer 02"}</span><CaretRight size={12} />
                <span>Base Views</span><CaretRight size={12} />
                <strong>{selectedDirection} ({activeDirection.name})</strong>
              </div>
              <div className="asset-heading">
                <div className="asset-title-wrap">
                  <h1>{workspace?.character_name ?? "Novice Adventurer 02"}</h1>
                  <p className="asset-summary">
                    <span>{currentViewCount || 5} {currentViewCount === 1 ? "stored view" : "base view references"}</span>
                    <span className="summary-dot">•</span><span>128 × 128</span>
                    <span className="summary-dot">•</span>
                    <span className={`readiness ${validation?.valid ? "readiness-good" : ""}`}><span className="readiness-dot" />{readiness}</span>
                  </p>
                </div>
                <div className="workspace-actions">
                  {!workspace ? (
                    <button className="primary-button" type="button" onClick={() => { setModalOpen(true); setFormError(""); }}><Plus size={16} weight="bold" /> Create character spec</button>
                  ) : (
                    <>
                      <button className="secondary-button" type="button" onClick={prepareViews} disabled={busy}><Sparkle size={15} weight="fill" /> Prepare prompts</button>
                      <button
                        className="secondary-button upload-selected"
                        type="button"
                        onClick={() => document.getElementById(`upload-${selectedDirection}`)?.click()}
                        disabled={busy || !promptsReady}
                        title={promptsReady ? `Ingest generated ${selectedDirection} PNG` : "Prepare base-view prompts first"}
                      ><UploadSimple size={15} weight="bold" /> Upload {selectedDirection}</button>
                      <button className="primary-button" type="button" onClick={validateViews} disabled={busy}><CheckCircle size={16} weight="fill" /> Validate</button>
                    </>
                  )}
                </div>
              </div>

              <div className="stage-switcher" role="tablist" aria-label="Character authoring stage">
                {["Reference", "Parts", "Rig"].map((name) => (
                  <button key={name} type="button" role="tab" aria-selected={stage === name} className={stage === name ? "is-active" : ""} onClick={() => setStage(name)} disabled={name === "Rig" && approvedParts.length === 0}>
                    {name}
                    {name === "Parts" && <span>{approvedParts.length}/{parts.length || 17}</span>}
                  </button>
                ))}
              </div>

              {stage === "Reference" ? (
                <>
                  <div className="preview-stage" aria-label={`${selectedDirection} character reference`}>
                    <CharacterArt direction={activeDirection} imageUrl={activeImage} className="hero-art" />
                    <div className="stage-label"><span className="stage-live-dot" />REFERENCE · {activeView ? "STORED PNG" : "SOURCE KIT"}</div>
                    <div className="stage-size">128 × 128 · authoring target ≥ 512²</div>
                  </div>
                  <div className="view-grid" aria-label="Base view references">
                    {DIRECTIONS.map((direction) => (
                      <ViewCard
                        key={direction.key}
                        direction={direction}
                        selected={direction.key === selectedDirection}
                        saved={viewsByDirection[direction.key]}
                        validation={validation}
                        imageUrl={workspace && viewsByDirection[direction.key] ? savedImageUrl(workspace.character_id, direction.key) : null}
                        generationReady={Boolean(generation?.views?.some((view) => view.direction === direction.key))}
                        onSelect={() => setSelectedDirection(direction.key)}
                        onUpload={uploadView}
                      />
                    ))}
                  </div>
                  {validation?.valid && (
                    <div className="parts-cta">
                      <div><strong>{selectedDirection} reference validated</strong><span>Parts {partReadiness[selectedDirection]?.approved ?? 0} / 17 approved</span></div>
                      <button className="primary-button" type="button" onClick={() => extractParts()} disabled={busy || !activeView || selectedParts.length > 0}><Cube size={15} weight="fill" /> {selectedParts.length ? "Parts extracted" : "Extract Parts"}</button>
                    </div>
                  )}
                </>
              ) : stage === "Parts" ? (
                <section className="parts-workspace" aria-label={`${selectedDirection} semantic parts`}>
                  <div className="parts-toolbar">
                    <div><span className="eyebrow">DIRECTION {selectedDirection}</span><h2>Semantic parts</h2><p>Draft masks are template-assisted. Review every part before rig binding.</p></div>
                    <button className="secondary-button" type="button" onClick={() => extractParts()} disabled={busy || !activeView || selectedParts.length > 0}>{selectedParts.length ? "17 parts extracted" : "Extract Parts"}</button>
                  </div>
                  <div className="parts-layout">
                    <div className="parts-reference">
                      <div className="preview-stage compact"><CharacterArt direction={activeDirection} imageUrl={activeImage} className="hero-art" /><div className="stage-label">REFERENCE</div></div>
                      <div className="resolution-warning"><WarningCircle size={16} weight="fill" /><span>128 × 128 source: suitable for workflow review, below the recommended 512 × 512 authoring master.</span></div>
                    </div>
                    <div className="parts-grid">
                      {selectedParts.length ? selectedParts.map((part) => (
                        <article className={`part-card ${part.approved ? "is-approved" : ""}`} key={part.part_id}>
                          <div className="part-preview"><img src={partImageUrl(workspace.character_id, part.part_id)} alt={`${part.name} cutout`} /></div>
                          <div className="part-card-copy"><strong>{part.name}</strong><span>{part.status} · {Math.round((part.confidence ?? 0) * 100)}% confidence</span><small>bone · {part.bone_hint}</small></div>
                          {part.approved ? <span className="part-approved"><CheckCircle size={14} weight="fill" /> Approved</span> : <button className="secondary-button compact-button" type="button" onClick={() => approvePart(part)} disabled={busy}>Approve</button>}
                        </article>
                      )) : (
                        <div className="parts-empty"><Cube size={28} /><strong>No semantic parts yet</strong><span>Validate the reference, then extract the 17-part biped chibi template.</span></div>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <section className="inline-rig-stage">
                  <div className="rig-card">
                    <div className="rig-card-icon"><GearSix size={22} weight="fill" /></div>
                    <div className="rig-card-copy"><strong>{rig ? `Rig v${rig.version}` : "Rig not created"}</strong><span>{approvedParts.length} approved parts · {rig?.bindings?.length ?? 0} bindings</span></div>
                    {!rig ? <button className="primary-button" type="button" onClick={createRig} disabled={busy || approvedParts.length === 0}>Create rig</button> : <button className="primary-button" type="button" onClick={autoBindRig} disabled={busy}>Auto Bind</button>}
                  </div>
                  <div className="rig-stage-note">Rig creation is unlocked only after at least one part is approved. Auto Bind ignores draft parts.</div>
                </section>
              )}

              <section className="recent-operation">
                <div className="recent-heading">
                  <h2>Recent Operation</h2>
                  {history.length > 1 && <button type="button" className="history-count" onClick={showInspector}>{history.length} calls · View Inspector</button>}
                </div>
                {call ? (
                  <div className="recent-row">
                    <div className={`recent-state ${call.succeeded ? "" : "has-error"}`}>{call.succeeded ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}</div>
                    <div className="recent-name"><strong>{call.tool.replaceAll("_", " ")}</strong><span>{call.tool}</span></div>
                    <time>{new Date(call.timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time>
                    <span className="recent-duration">{call.duration} ms</span>
                    <button type="button" className="details-link" onClick={showInspector}>View Details <ArrowSquareOut size={13} /></button>
                  </div>
                ) : (
                  <div className="recent-empty"><span>Choose a workflow action to inspect its live MCP request and response.</span></div>
                )}
              </section>
              {notice && <div className="notice" role="status"><span>{notice}</span><IconButton label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></IconButton></div>}
            </>
          ) : section === "Projects" ? (
            <section className="secondary-view">
              <div className="breadcrumbs"><span>Projects</span><CaretRight size={12} /><strong>{workspace?.project_name ?? "RO Original Male"}</strong></div>
              <div className="secondary-title"><div><span className="eyebrow">ACTIVE PROJECT</span><h1>{workspace?.project_name ?? "RO Original Male"}</h1><p>Character specs and source assets in this workspace.</p></div><FolderSimple size={28} weight="fill" /></div>
              <button className="project-character-row" type="button" onClick={() => setSection("Characters")}>
                <span className="tree-avatar large"><CharacterArt direction={DIRECTIONS[0]} /></span>
                <span><strong>{workspace?.character_name ?? "Novice Adventurer 02"}</strong><small>{currentViewCount}/5 base views · 128 × 128</small></span>
                <CaretRight size={18} />
              </button>
              {!workspace && <button className="primary-button create-project-button" type="button" onClick={() => { setModalOpen(true); setFormError(""); }}><Plus size={16} /> Create this project in v0.3.0</button>}
            </section>
          ) : (
            <section className="secondary-view">
              <div className="breadcrumbs"><span>Projects</span><CaretRight size={12} /><span>{workspace?.project_name ?? "RO Original Male"}</span><CaretRight size={12} /><strong>Rigs</strong></div>
              <div className="secondary-title"><div><span className="eyebrow">RIG WORKSPACE</span><h1>{workspace?.character_name ?? "Novice Adventurer 02"}</h1><p>Build the character rig from the active spec preset.</p></div><GearSix size={30} weight="fill" /></div>
              <div className="rig-card">
                <div className="rig-card-icon"><Cube size={22} weight="fill" /></div>
                <div className="rig-card-copy"><strong>Biped chibi · v1</strong><span>{spec?.rig_preset ?? "biped_chibi_v1"} · {approvedParts.length} approved parts · {rig?.bindings?.length ?? 0} bound</span></div>
                {!rig ? <button className="primary-button" type="button" onClick={createRig} disabled={!workspace || busy || approvedParts.length === 0}><GearSix size={15} weight="fill" /> Create rig</button> : <button className="primary-button" type="button" onClick={autoBindRig} disabled={busy}><GearSix size={15} weight="fill" /> Auto Bind</button>}
              </div>
              {!workspace && <button className="primary-button create-project-button" type="button" onClick={() => { setModalOpen(true); setFormError(""); }}><Plus size={16} /> Create a character spec first</button>}
              {notice && <div className="notice" role="status"><span>{notice}</span><IconButton label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></IconButton></div>}
            </section>
          )}
        </main>

        <aside className="inspector" ref={inspectorRef} aria-label="MCP operation inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector views">
            {[
              { name: "Inspector", count: null },
              { name: "Metadata", count: null },
            ].map((tab) => (
              <button key={tab.name} type="button" role="tab" aria-selected={inspectorTab === tab.name} className={inspectorTab === tab.name ? "is-active" : ""} onClick={() => setInspectorTab(tab.name)}>{tab.name}</button>
            ))}
          </div>
          {inspectorTab === "Inspector" ? (
            <div className="inspector-scroll">
              <section className="inspector-section">
                <div className="inspector-section-heading"><h3>MCP Tool</h3>{call && <IconButton label="Copy tool name" onClick={() => copyText(call.tool, "Tool name")}><Copy size={15} /></IconButton>}</div>
                <div className="value-box tool-name">{call?.tool ?? "No tool call yet"}</div>
              </section>
              <CodePanel title="Request" value={call?.request ?? null} emptyLabel="Run a workflow action to see the exact arguments sent to the MCP server." onCopy={call ? () => copyText(call.request, "Request") : null} />
              <CodePanel title="Response" value={call?.response ?? null} emptyLabel="The structured MCP result will appear here." onCopy={call?.response ? () => copyText(call.response, "Response") : null} />
              <section className="inspector-section">
                <div className="inspector-section-heading"><h3>REST equivalent</h3>{call && <IconButton label="Copy REST equivalent" onClick={() => copyText(call.rest, "REST equivalent")}><Copy size={15} /></IconButton>}</div>
                {call ? (
                  <>
                    <div className="value-box rest-route"><span className={`http-method method-${call.rest.method.toLowerCase()}`}>{call.rest.method}</span><code>{call.rest.path}</code></div>
                    {call.rest.body && <details className="rest-body"><summary>REST request body</summary><pre>{jsonText(call.rest.body)}</pre></details>}
                  </>
                ) : <div className="value-box rest-route empty-route">REST path appears with the first call</div>}
              </section>
              <section className="inspector-facts">
                <div className="fact-row"><strong>Status</strong><span className={`fact-status ${call ? call.validationFailed ? "warning" : call.succeeded ? "success" : "error" : "pending"}`}>{call ? call.validationFailed ? <WarningCircle size={18} weight="fill" /> : call.succeeded ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" /> : <CircleNotch size={17} />}<span>{call ? call.validationFailed ? `needs review · HTTP ${call.statusCode}` : call.succeeded ? `success · HTTP ${call.statusCode}` : `error · ${call.statusCode}` : "waiting for call"}</span></span></div>
                <div className="fact-row"><strong>Duration</strong><span>{call ? `${call.duration} ms` : "—"}</span></div>
                <div className="fact-row errors-row"><strong>Errors</strong><span className={call?.errors?.length ? "error-text" : call?.warnings?.length ? "warning-text" : ""}>{call?.errors?.length || call?.warnings?.length ? [...(call.errors ?? []).map((error) => error.message ?? JSON.stringify(error)), ...(call.warnings ?? []).map((warning) => `Warning: ${warning}`)].join(" · ") : call ? "None" : "—"}</span></div>
              </section>
              <CodePanel title="Provenance" value={call?.provenance ?? null} emptyLabel="Server, generator, and source details will appear here." onCopy={call?.provenance ? () => copyText(call.provenance, "Provenance") : null} />
              <section className="inspector-section next-tool-section">
                <div className="inspector-section-heading"><h3>Next tool</h3>{call && <IconButton label="Copy next tool name" onClick={() => copyText(call.nextTool, "Next tool")}><Copy size={15} /></IconButton>}</div>
                <div className="value-box next-tool">{call?.nextTool ?? (workspace ? "character.prepare_base_views" : "project.create")}</div>
              </section>
            </div>
          ) : (
            <div className="inspector-scroll metadata-scroll">
              <div className="metadata-heading"><span className="eyebrow">SELECTED ASSET</span><h2>{selectedDirection} ({activeDirection.name})</h2><p>Novice Adventurer 02 · idle reference · 128 × 128</p></div>
              <CodePanel title="Asset pair" value={{ body: activeDirection.bodyId, head_hair: activeDirection.hairId, direction: selectedDirection, action: "idle", frame: 0 }} onCopy={() => copyText({ body: activeDirection.bodyId, head_hair: activeDirection.hairId, direction: selectedDirection, action: "idle", frame: 0 }, "Asset metadata")} />
              <CodePanel title="Source provenance" value={{ pack: "RO_Original_Male_Adventurer_02", export: "editable generic asset export", generated_by: "Codex imagegen", source_type: "independent-component-atlas", root_anchor: { x: 64, y: 108 }, head_anchor: { x: 64, y: 59 } }} onCopy={() => copyText({ pack: "RO_Original_Male_Adventurer_02", export: "editable generic asset export", generated_by: "Codex imagegen", source_type: "independent-component-atlas", root_anchor: { x: 64, y: 108 }, head_anchor: { x: 64, y: 59 } }, "Source provenance")} />
              {generation && <CodePanel title="Prepared prompt" value={generation.views.find((view) => view.direction === selectedDirection)?.prompt ?? null} emptyLabel="No prompt prepared for this direction." onCopy={() => copyText(generation.views.find((view) => view.direction === selectedDirection)?.prompt ?? "", "Prompt")} />}
              {activeView && <CodePanel title="Stored view metadata" value={activeView} onCopy={() => copyText(activeView, "Stored view metadata")} />}
            </div>
          )}
        </aside>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
          <form className="workspace-modal" onSubmit={createWorkspace}>
            <div className="modal-heading"><div><span className="eyebrow">CHARACTER-ASSET · V0.3.0</span><h2>Create a workspace</h2><p>Start with the included Novice Adventurer source kit.</p></div><IconButton label="Close" onClick={() => setModalOpen(false)}><X size={18} /></IconButton></div>
            <label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={120} autoFocus /></label>
            <label>Character name<input value={characterName} onChange={(event) => setCharacterName(event.target.value)} maxLength={120} /></label>
            <div className="modal-source"><span className="tree-avatar"><CharacterArt direction={DIRECTIONS[0]} /></span><span><strong>Novice Adventurer 02</strong><small>5 directions · 128 × 128 · transparent PNG</small></span><CheckCircle size={17} weight="fill" /></div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? <CircleNotch className="spin" size={16} /> : <Plus size={16} weight="bold" />}{busy ? "Creating…" : "Create workspace"}</button></div>
          </form>
        </div>
      )}

      {busy && <div className="busy-indicator" aria-live="polite"><CircleNotch className="spin" size={15} /> Working with Character-Asset…</div>}
    </div>
  );
}

export { App };
