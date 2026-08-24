export const en = {
  common: {
    appName: "SigmaOS",
    root: "root",
    dash: "-",
    actions: {
      approve: "Approve",
      cancel: "Cancel",
      closeSettings: "Close settings",
      reject: "Reject",
      rollback: "Rollback",
      saveChanges: "Save Changes",
      saving: "Saving",
      send: "Send",
      stop: "Stop",
      refresh: "Refresh",
      up: "Up",
      homeDirectory: "Home directory",
      newAgent: "New agent",
      systemSettings: "System settings",
      resizePanes: "Resize panes"
    },
    states: {
      configured: "Configured",
      loading: "Loading",
      local: "Local",
      missing: "Missing",
      needsKey: "Needs key",
      planned: "Planned",
      ready: "Ready"
    },
    language: {
      system: "System default",
      english: "English",
      chineseSimplified: "Simplified Chinese"
    }
  },
  status: {
    starting: "Starting",
    offline: "Offline",
    loading: "Loading",
    error: "Error",
    ready: "Ready",
    "agent-running": "Agent running",
    reconnecting: "Reconnecting",
    "creating-agent": "Creating agent",
    searching: "Searching",
    queued: "Queued",
    cancelling: "Cancelling",
    cancelled: "Cancelled",
    applying: "Applying",
    rejecting: "Rejecting",
    restoring: "Restoring",
    "rolling-back": "Rolling back"
  },
  chat: {
    primaryViews: "Primary views",
    mobileChat: "Chat",
    mobileWorkspace: "Workspace",
    agents: "Agents",
    agentSessions: "Agent sessions",
    agentChat: "Agent chat",
    noRoot: "No root",
    agent: "Agent",
    rootAgent: "Root agent",
    sessionMetrics: "Session metrics",
    transcript: "Transcript",
    sigmaAgent: "Sigma Agent",
    you: "You",
    emptyTitle: "Ready for a NAS task.",
    emptyBody: "Ask about the selected folder or request approval-gated file work.",
    approvals: "Approvals",
    pendingApprovals: "Pending approvals",
    noApprovals: "No pending approvals.",
    risk: "{{risk}} risk",
    risks: {
      low: "low",
      medium: "medium",
      high: "high"
    },
    approvalCards: {
      fileOperation: "File operation",
      fileTitle: "File work",
      fileApproval: "Review the requested file operation.",
      toolCall: "Tool call",
      toolTitle: "Pi {{tool}}",
      toolApproval: "Review the requested tool call.",
      root: "Root",
      paths: "Paths",
      cwd: "CWD",
      args: "Args"
    },
    messagePlaceholder: "Message Sigma Agent",
    messageAria: "Agent message",
    metrics: {
      messages_one: "{{formattedCount}} message",
      messages_other: "{{formattedCount}} messages",
      events_one: "{{formattedCount}} event",
      events_other: "{{formattedCount}} events"
    }
  },
  workspace: {
    label: "Workspace",
    rootLabel: "Root",
    breadcrumbs: "Breadcrumbs",
    searchPlaceholder: "Search filenames",
    searchAria: "Search filenames",
    fileBrowser: "File browser",
    files: "Files",
    items: "Items",
    safe: "Safe",
    table: {
      files: "Files",
      name: "Name",
      type: "Type",
      size: "Size",
      modified: "Modified"
    },
    preview: "Preview",
    selectFile: "Select a file",
    collapsePreview: "Collapse preview",
    expandPreview: "Expand preview",
    recentOperations: "Recent operations",
    activity: "Activity"
  },
  editor: {
    eyebrow: "Editor",
    open: "Edit file",
    close: "Close editor",
    textarea: "File contents",
    reload: "Reload",
    savedAt: "saved {{time}}",
    notSaved: "not saved",
    states: {
      loading: "Loading",
      error: "Error",
      conflict: "Changed elsewhere",
      saving: "Saving",
      unsaved: "Unsaved",
      saved: "Saved"
    }
  },
  settings: {
    sectionsLabel: "Settings sections",
    searchPlaceholder: "Search settings",
    searchEmpty: "No settings match.",
    localProfile: "Local profile",
    status: "Settings status",
    secretsMasked: "Secrets masked",
    providerSummary: "Provider summary",
    groups: {
      sigmaos: "SigmaOS",
      ai: "AI",
      workspace: "Workspace",
      administration: "Administration"
    },
    sections: {
      overview: {
        title: "Overview",
        description: "Service status and appliance identity."
      },
      modelProviders: {
        title: "Model Providers",
        description: "Third-party model provider credentials and endpoint routing."
      },
      agents: {
        title: "Agents",
        description: "Agent defaults, tools, approvals, and memory policy."
      },
      files: {
        title: "Files & Preview",
        description: "Preview limits, media behavior, indexing, and trash policy."
      },
      security: {
        title: "Security",
        description: "Access control, secret handling, and operation safety."
      },
      appearance: {
        title: "Appearance",
        description: "Theme, language, density, layout defaults, and motion settings."
      },
      advanced: {
        title: "Advanced",
        description: "Diagnostics, runtime paths, backups, and maintenance."
      }
    },
    modelProvider: {
      profileTitle: "Provider Profile",
      profileDescription: "Primary routing information for third-party model calls.",
      provider: "Provider",
      displayName: "Display name",
      baseUrl: "Base URL",
      model: "Model",
      credentialsTitle: "Credentials",
      credentialsDescription: "Stored secrets stay masked after save.",
      apiKey: "API key",
      clearApiKey: "Clear saved API key",
      apiKeyNote: "API responses only return whether a key is configured.",
      activeRoute: "Active Route",
      activeRouteDescription: "Current model provider profile.",
      endpoint: "Endpoint",
      updated: "Updated",
      providerSlots: "Provider Slots",
      providerSlotsDescription: "Structure reserved for fallback routing.",
      primary: "Primary",
      fallback: "Fallback",
      fallbackDescription: "Secondary provider profile",
      local: "Local",
      localDescription: "LAN or on-device model endpoint",
      defaultEndpoint: "Default runtime endpoint",
      notSet: "Not set",
      notLoaded: "Not loaded",
      notSaved: "Not saved",
      loadingSettings: "Loading settings",
      apiKeyConfigured: "API key configured",
      noApiKey: "No API key",
      configuredPlaceholder: "Configured",
      notConfiguredPlaceholder: "Not configured",
      providers: {
        google: "Google",
        openai: "OpenAI",
        anthropic: "Anthropic",
        openrouter: "OpenRouter",
        local: "Local endpoint"
      }
    },
    toolPolicy: {
      readOnlyTitle: "Read-Only Tools",
      readOnlyDescription: "Tools that can run automatically while staying inside the NAS root.",
      dangerousTitle: "Approval Tools",
      dangerousDescription: "Mutating or shell tools always require approval or can be disabled.",
      auditTitle: "Approval Flow",
      auditDescription: "Pi waits for the SigmaOS approval decision before the same turn continues.",
      askOnly: "Ask or disabled",
      pendingMode: "Pending calls",
      workerWaits: "Worker holds the Pi turn",
      saved: "Tool policy saved",
      defaultsActive: "Default tool policy active",
      modes: {
        auto: "Auto",
        ask: "Ask",
        disabled: "Disabled"
      },
      tools: {
        read: "Read text files through NAS path safety.",
        grep: "Search file contents inside the selected NAS root.",
        find: "Find matching files and folders inside the NAS root.",
        ls: "List directory entries inside the NAS root.",
        bash: "Run a shell command from the safe workspace cwd.",
        edit: "Apply oldText/newText replacements to an existing file.",
        write: "Write or replace a file inside the NAS root."
      }
    },
    overview: {
      systemProfile: "System Profile",
      systemProfileDescription: "Local SigmaOS workspace configuration.",
      sections: "Sections",
      configured: "Configured",
      planned: "Planned",
      modelProvider: "Model Provider",
      modelProviderDescription: "Current third-party model connection.",
      settingsMap: "Settings Map",
      settingsMapDescription: "Configuration areas are separated by responsibility."
    },
    appearance: {
      languageTitle: "Language",
      languageDescription: "Choose the interface language for this browser.",
      languageField: "Interface language",
      languageHelp: "System default follows your browser preference."
    },
    files: {
      editorTitle: "Editor Typography",
      editorDescription: "Code font used by text preview, code blocks, tables, and the live editor.",
      monoFont: "Mono font",
      monoFontHelp: "Choose an installed monospace face; each option falls back to a safe system mono stack.",
      fontSize: "Font size",
      fontSizeHelp: "Applies immediately in this browser.",
      previewTitle: "Preview Limits",
      previewDescription: "Control which files can open in the preview pane.",
      previewFileSizeLimit: "Max preview file size",
      previewFileSizeLimitHelp: "Files above {{limit}} show metadata only and are not opened inline.",
      megabytes: "MB",
      pixels: "px"
    },
    blueprints: {
      agents: {
        defaultsTitle: "Agent Defaults",
        defaultsDescription: "Baseline behavior for every new agent session.",
        defaultMode: "Default mode",
        defaultModeDetail: "Initial reasoning and execution profile.",
        balanced: "Balanced",
        sessionMemory: "Session memory",
        sessionMemoryDetail: "Transcript and workspace context retention.",
        perRoot: "Per root",
        toolRouting: "Tool routing",
        toolRoutingDetail: "Filesystem, terminal, and preview tool availability.",
        roleBased: "Role based",
        approvalTitle: "Approval Policy",
        approvalDescription: "Operation gates before agents modify the workspace.",
        destructiveActions: "Destructive file actions",
        destructiveActionsDetail: "Delete, overwrite, and rollback requests.",
        askFirst: "Ask first",
        shellCommands: "Shell commands",
        shellCommandsDetail: "Command classes that require confirmation.",
        profileRules: "Profile rules",
        stopBehavior: "Stop behavior",
        stopBehaviorDetail: "How active jobs are interrupted.",
        immediate: "Immediate"
      },
      files: {
        browserTitle: "Browser & Preview",
        browserDescription: "Limits and handlers for the right workspace pane.",
        textPreviewCap: "Text preview cap",
        textPreviewCapDetail: "Maximum UTF-8 bytes returned for inline reads.",
        pdfHandler: "PDF handler",
        pdfHandlerDetail: "Browser-native PDF viewer in the preview pane.",
        native: "Native",
        mediaStreaming: "Media streaming",
        mediaStreamingDetail: "Range-enabled audio and video playback.",
        enabled: "Enabled",
        indexingTitle: "Indexing",
        indexingDescription: "Workspace discovery, search freshness, and ignored paths.",
        searchIndex: "Search index",
        searchIndexDetail: "Background file indexing per root.",
        manual: "Manual",
        hiddenFiles: "Hidden files",
        hiddenFilesDetail: "Visibility of dotfiles and generated folders.",
        filtered: "Filtered",
        largeFilePolicy: "Large file policy",
        largeFilePolicyDetail: "Preview and scan behavior for large binaries.",
        metadataOnly: "Metadata only"
      },
      security: {
        secretsTitle: "Secrets",
        secretsDescription: "Credential storage and masking rules.",
        apiKeyDisplay: "API key display",
        apiKeyDisplayDetail: "Stored credentials never render in plain text.",
        masked: "Masked",
        secretRotation: "Secret rotation",
        secretRotationDetail: "Replace credentials without revealing the old value.",
        manual: "Manual",
        exportPolicy: "Export policy",
        exportPolicyDetail: "Whether settings exports include sensitive fields.",
        redacted: "Redacted",
        workspaceSafetyTitle: "Workspace Safety",
        workspaceSafetyDescription: "Guards around files, roots, and agent operations.",
        pathTraversal: "Path traversal",
        pathTraversalDetail: "API path resolution stays inside the selected root.",
        blocked: "Blocked",
        operationAudit: "Operation audit",
        operationAuditDetail: "File operation proposals and outcomes.",
        recorded: "Recorded",
        adminLocks: "Admin locks",
        adminLocksDetail: "High-risk settings require elevated confirmation."
      },
      appearance: {
        interfaceTitle: "Interface",
        interfaceDescription: "Workspace layout, density, and theme preferences.",
        theme: "Theme",
        themeDetail: "Discord-like dark surface hierarchy.",
        dark: "Dark",
        density: "Density",
        densityDetail: "Compact controls for repeated agent work.",
        compact: "Compact",
        splitWidth: "Split width",
        splitWidthDetail: "Persisted chat and workspace pane sizing.",
        savedLocally: "Saved locally",
        motionTitle: "Motion",
        motionDescription: "Transitions for modal, navigation, and preview changes.",
        reducedMotion: "Reduced motion",
        reducedMotionDetail: "Respect OS-level motion preferences.",
        system: "System",
        panelTransitions: "Panel transitions",
        panelTransitionsDetail: "Lightweight content and hover feedback.",
        subtle: "Subtle",
        mobileTabs: "Mobile tabs",
        mobileTabsDetail: "Chat and workspace switch behavior.",
        enabled: "Enabled"
      },
      advanced: {
        runtimeTitle: "Runtime",
        runtimeDescription: "Local service, worker, and diagnostics configuration.",
        apiEndpoint: "API endpoint",
        apiEndpointDetail: "Web client target for SigmaOS API routes.",
        sameOrigin: "Same origin",
        workerRouting: "Worker routing",
        workerRoutingDetail: "Apply provider settings to agent execution.",
        pending: "Pending",
        diagnostics: "Diagnostics",
        diagnosticsDetail: "Runtime health snapshots and logs.",
        maintenanceTitle: "Maintenance",
        maintenanceDescription: "Backups, imports, and service-level administration.",
        settingsBackup: "Settings backup",
        settingsBackupDetail: "Export non-secret system settings.",
        resetSection: "Reset section",
        resetSectionDetail: "Restore defaults for one settings area.",
        schemaStatus: "Schema status",
        schemaStatusDetail: "Database migration visibility."
      }
    }
  },
  preview: {
    loading: "Loading preview...",
    chooseFile: "Choose a previewable file.",
    cannotPreview: "{{size}} cannot be previewed inline.",
    tooLarge: "This file is {{size}}. Preview limit is {{limit}}, so it was not opened.",
    truncated: "Preview truncated",
    modeAria: "Text preview mode",
    modes: {
      rendered: "Rendered",
      table: "Table",
      source: "Source"
    },
    kind: {
      directory: "directory",
      text: "text",
      image: "image",
      audio: "audio",
      video: "video",
      pdf: "pdf",
      unsupported: "unsupported"
    },
    column: "Column {{index}}",
    tableTruncated: "Showing {{rows}} of {{totalRows}} rows and {{columns}} of {{totalColumns}} columns."
  },
  files: {
    labels: {
      archive: "archive",
      audio: "audio",
      blocked: "blocked",
      code: "code",
      config: "config",
      database: "database",
      directory: "folder",
      document: "document",
      font: "font",
      image: "image",
      json: "JSON",
      markdown: "markdown",
      other: "file",
      package: "package",
      pdf: "PDF",
      secure: "secret",
      shell: "script",
      spreadsheet: "table",
      symlink: "link",
      text: "text",
      video: "video"
    }
  }
} as const;

type LocaleResource<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : LocaleResource<T[K]>;
};

export const zhCN = {
  common: {
    appName: "SigmaOS",
    root: "根目录",
    dash: "-",
    actions: {
      approve: "批准",
      cancel: "取消",
      closeSettings: "关闭设置",
      reject: "拒绝",
      rollback: "回滚",
      saveChanges: "保存更改",
      saving: "保存中",
      send: "发送",
      stop: "停止",
      refresh: "刷新",
      up: "上一级",
      homeDirectory: "主目录",
      newAgent: "新建 agent",
      systemSettings: "系统设置",
      resizePanes: "调整面板宽度"
    },
    states: {
      configured: "已配置",
      loading: "加载中",
      local: "本地",
      missing: "缺失",
      needsKey: "需要密钥",
      planned: "计划中",
      ready: "就绪"
    },
    language: {
      system: "跟随系统",
      english: "English",
      chineseSimplified: "简体中文"
    }
  },
  status: {
    starting: "启动中",
    offline: "离线",
    loading: "加载中",
    error: "错误",
    ready: "就绪",
    "agent-running": "Agent 运行中",
    reconnecting: "重连中",
    "creating-agent": "创建 agent",
    searching: "搜索中",
    queued: "已排队",
    cancelling: "取消中",
    cancelled: "已取消",
    applying: "应用中",
    rejecting: "拒绝中",
    restoring: "恢复中",
    "rolling-back": "回滚中"
  },
  chat: {
    primaryViews: "主视图",
    mobileChat: "聊天",
    mobileWorkspace: "工作区",
    agents: "Agents",
    agentSessions: "Agent 会话",
    agentChat: "Agent 聊天",
    noRoot: "无根目录",
    agent: "Agent",
    rootAgent: "根目录 agent",
    sessionMetrics: "会话指标",
    transcript: "转录",
    sigmaAgent: "Sigma Agent",
    you: "你",
    emptyTitle: "可以处理 NAS 任务。",
    emptyBody: "询问所选文件夹，或请求需要审批的文件操作。",
    approvals: "审批",
    pendingApprovals: "待审批",
    noApprovals: "没有待审批项。",
    risk: "{{risk}} 风险",
    risks: {
      low: "低",
      medium: "中",
      high: "高"
    },
    approvalCards: {
      fileOperation: "文件操作",
      fileTitle: "文件任务",
      fileApproval: "请确认请求的文件操作。",
      toolCall: "工具调用",
      toolTitle: "Pi {{tool}}",
      toolApproval: "请确认请求的工具调用。",
      root: "根目录",
      paths: "路径",
      cwd: "工作目录",
      args: "参数"
    },
    messagePlaceholder: "给 Sigma Agent 发消息",
    messageAria: "Agent 消息",
    metrics: {
      messages_one: "{{formattedCount}} 条消息",
      messages_other: "{{formattedCount}} 条消息",
      events_one: "{{formattedCount}} 个事件",
      events_other: "{{formattedCount}} 个事件"
    }
  },
  workspace: {
    label: "工作区",
    rootLabel: "根目录",
    breadcrumbs: "面包屑",
    searchPlaceholder: "搜索文件名",
    searchAria: "搜索文件名",
    fileBrowser: "文件浏览器",
    files: "文件",
    items: "项目",
    safe: "安全",
    table: {
      files: "文件",
      name: "名称",
      type: "类型",
      size: "大小",
      modified: "修改时间"
    },
    preview: "预览",
    selectFile: "选择文件",
    collapsePreview: "收起预览",
    expandPreview: "展开预览",
    recentOperations: "最近操作",
    activity: "活动"
  },
  editor: {
    eyebrow: "编辑器",
    open: "编辑文件",
    close: "关闭编辑器",
    textarea: "文件内容",
    reload: "重新加载",
    savedAt: "已保存 {{time}}",
    notSaved: "未保存",
    states: {
      loading: "加载中",
      error: "错误",
      conflict: "外部已修改",
      saving: "保存中",
      unsaved: "未保存",
      saved: "已保存"
    }
  },
  settings: {
    sectionsLabel: "设置分区",
    searchPlaceholder: "搜索设置",
    searchEmpty: "没有匹配的设置。",
    localProfile: "本地配置",
    status: "设置状态",
    secretsMasked: "密钥已隐藏",
    providerSummary: "Provider 摘要",
    groups: {
      sigmaos: "SigmaOS",
      ai: "AI",
      workspace: "工作区",
      administration: "管理"
    },
    sections: {
      overview: {
        title: "概览",
        description: "服务状态和设备身份。"
      },
      modelProviders: {
        title: "模型 Provider",
        description: "第三方模型 provider 凭据和端点路由。"
      },
      agents: {
        title: "Agents",
        description: "Agent 默认值、工具、审批和记忆策略。"
      },
      files: {
        title: "文件与预览",
        description: "预览限制、媒体行为、索引和回收站策略。"
      },
      security: {
        title: "安全",
        description: "访问控制、密钥处理和操作安全。"
      },
      appearance: {
        title: "外观",
        description: "主题、语言、密度、布局默认值和动效设置。"
      },
      advanced: {
        title: "高级",
        description: "诊断、运行时路径、备份和维护。"
      }
    },
    modelProvider: {
      profileTitle: "Provider 配置",
      profileDescription: "第三方模型调用的主要路由信息。",
      provider: "Provider",
      displayName: "显示名称",
      baseUrl: "Base URL",
      model: "模型",
      credentialsTitle: "凭据",
      credentialsDescription: "保存后密钥保持隐藏。",
      apiKey: "API key",
      clearApiKey: "清除已保存 API key",
      apiKeyNote: "API 响应只返回是否已配置 key。",
      activeRoute: "当前路由",
      activeRouteDescription: "当前模型 provider 配置。",
      endpoint: "端点",
      updated: "更新",
      providerSlots: "Provider 槽位",
      providerSlotsDescription: "为 fallback 路由预留的结构。",
      primary: "主配置",
      fallback: "Fallback",
      fallbackDescription: "备用 provider 配置",
      local: "本地",
      localDescription: "局域网或设备本地模型端点",
      defaultEndpoint: "默认运行时端点",
      notSet: "未设置",
      notLoaded: "未加载",
      notSaved: "未保存",
      loadingSettings: "正在加载设置",
      apiKeyConfigured: "API key 已配置",
      noApiKey: "无 API key",
      configuredPlaceholder: "已配置",
      notConfiguredPlaceholder: "未配置",
      providers: {
        google: "Google",
        openai: "OpenAI",
        anthropic: "Anthropic",
        openrouter: "OpenRouter",
        local: "本地端点"
      }
    },
    toolPolicy: {
      readOnlyTitle: "只读工具",
      readOnlyDescription: "只读工具可自动运行，但始终受 NAS root 路径保护。",
      dangerousTitle: "审批工具",
      dangerousDescription: "会修改文件或执行 shell 的工具必须审批，或直接禁用。",
      auditTitle: "审批流",
      auditDescription: "Pi 会等待 SigmaOS 审批结果，再继续同一轮对话。",
      askOnly: "审批或禁用",
      pendingMode: "等待调用",
      workerWaits: "Worker 保持 Pi turn",
      saved: "工具策略已保存",
      defaultsActive: "默认工具策略生效",
      modes: {
        auto: "自动",
        ask: "审批",
        disabled: "禁用"
      },
      tools: {
        read: "通过 NAS 路径安全读取文本文件。",
        grep: "在选中的 NAS root 内搜索文件内容。",
        find: "在 NAS root 内查找匹配的文件和文件夹。",
        ls: "列出 NAS root 内的目录项。",
        bash: "从安全工作目录执行 shell 命令。",
        edit: "对已有文件应用 oldText/newText 替换。",
        write: "在 NAS root 内写入或替换文件。"
      }
    },
    overview: {
      systemProfile: "系统配置",
      systemProfileDescription: "本地 SigmaOS 工作区配置。",
      sections: "分区",
      configured: "已配置",
      planned: "计划中",
      modelProvider: "模型 Provider",
      modelProviderDescription: "当前第三方模型连接。",
      settingsMap: "设置地图",
      settingsMapDescription: "配置区域按职责分组。"
    },
    appearance: {
      languageTitle: "语言",
      languageDescription: "选择此浏览器的界面语言。",
      languageField: "界面语言",
      languageHelp: "跟随系统会使用浏览器语言偏好。"
    },
    files: {
      editorTitle: "编辑器字体",
      editorDescription: "用于文本预览、代码块、表格和实时编辑器的代码字体。",
      monoFont: "Mono 字体",
      monoFontHelp: "选择已安装的等宽字体；每个选项都会回退到安全的系统等宽字体。",
      fontSize: "字体大小",
      fontSizeHelp: "在当前浏览器中立即生效。",
      previewTitle: "预览限制",
      previewDescription: "控制哪些文件可以在预览面板中打开。",
      previewFileSizeLimit: "最大预览文件大小",
      previewFileSizeLimitHelp: "超过 {{limit}} 的文件只显示元数据，不会内联打开。",
      megabytes: "MB",
      pixels: "px"
    },
    blueprints: {
      agents: {
        defaultsTitle: "Agent 默认值",
        defaultsDescription: "每个新 agent 会话的基准行为。",
        defaultMode: "默认模式",
        defaultModeDetail: "初始推理和执行配置。",
        balanced: "平衡",
        sessionMemory: "会话记忆",
        sessionMemoryDetail: "转录和工作区上下文保留。",
        perRoot: "按根目录",
        toolRouting: "工具路由",
        toolRoutingDetail: "文件系统、终端和预览工具可用性。",
        roleBased: "按角色",
        approvalTitle: "审批策略",
        approvalDescription: "Agent 修改工作区前的操作门禁。",
        destructiveActions: "破坏性文件操作",
        destructiveActionsDetail: "删除、覆盖和回滚请求。",
        askFirst: "先询问",
        shellCommands: "Shell 命令",
        shellCommandsDetail: "需要确认的命令类别。",
        profileRules: "配置规则",
        stopBehavior: "停止行为",
        stopBehaviorDetail: "如何中断活跃任务。",
        immediate: "立即"
      },
      files: {
        browserTitle: "浏览与预览",
        browserDescription: "右侧工作区面板的限制和处理器。",
        textPreviewCap: "文本预览上限",
        textPreviewCapDetail: "内联读取返回的最大 UTF-8 字节数。",
        pdfHandler: "PDF 处理器",
        pdfHandlerDetail: "预览面板中的浏览器原生 PDF 查看器。",
        native: "原生",
        mediaStreaming: "媒体流",
        mediaStreamingDetail: "支持 Range 的音频和视频播放。",
        enabled: "已启用",
        indexingTitle: "索引",
        indexingDescription: "工作区发现、搜索新鲜度和忽略路径。",
        searchIndex: "搜索索引",
        searchIndexDetail: "按根目录后台索引文件。",
        manual: "手动",
        hiddenFiles: "隐藏文件",
        hiddenFilesDetail: "点文件和生成目录的可见性。",
        filtered: "已过滤",
        largeFilePolicy: "大文件策略",
        largeFilePolicyDetail: "大二进制文件的预览和扫描行为。",
        metadataOnly: "仅元数据"
      },
      security: {
        secretsTitle: "密钥",
        secretsDescription: "凭据存储和遮罩规则。",
        apiKeyDisplay: "API key 显示",
        apiKeyDisplayDetail: "已存储凭据永不明文渲染。",
        masked: "已隐藏",
        secretRotation: "密钥轮换",
        secretRotationDetail: "不暴露旧值的情况下替换凭据。",
        manual: "手动",
        exportPolicy: "导出策略",
        exportPolicyDetail: "设置导出是否包含敏感字段。",
        redacted: "已脱敏",
        workspaceSafetyTitle: "工作区安全",
        workspaceSafetyDescription: "围绕文件、根目录和 agent 操作的防护。",
        pathTraversal: "路径穿越",
        pathTraversalDetail: "API 路径解析保持在所选根目录内。",
        blocked: "已阻止",
        operationAudit: "操作审计",
        operationAuditDetail: "文件操作提案和结果。",
        recorded: "已记录",
        adminLocks: "管理员锁",
        adminLocksDetail: "高风险设置需要更高确认。"
      },
      appearance: {
        interfaceTitle: "界面",
        interfaceDescription: "工作区布局、密度和主题偏好。",
        theme: "主题",
        themeDetail: "Discord 风格暗色表面层级。",
        dark: "暗色",
        density: "密度",
        densityDetail: "适合重复 agent 工作的紧凑控件。",
        compact: "紧凑",
        splitWidth: "分栏宽度",
        splitWidthDetail: "持久化聊天和工作区面板宽度。",
        savedLocally: "本地保存",
        motionTitle: "动效",
        motionDescription: "弹窗、导航和预览变化的过渡。",
        reducedMotion: "减少动效",
        reducedMotionDetail: "遵循系统级动效偏好。",
        system: "系统",
        panelTransitions: "面板过渡",
        panelTransitionsDetail: "轻量内容和 hover 反馈。",
        subtle: "轻量",
        mobileTabs: "移动端标签",
        mobileTabsDetail: "聊天和工作区切换行为。",
        enabled: "已启用"
      },
      advanced: {
        runtimeTitle: "运行时",
        runtimeDescription: "本地服务、worker 和诊断配置。",
        apiEndpoint: "API 端点",
        apiEndpointDetail: "Web 客户端的 SigmaOS API 路由目标。",
        sameOrigin: "同源",
        workerRouting: "Worker 路由",
        workerRoutingDetail: "将 provider 设置应用到 agent 执行。",
        pending: "待处理",
        diagnostics: "诊断",
        diagnosticsDetail: "运行时健康快照和日志。",
        maintenanceTitle: "维护",
        maintenanceDescription: "备份、导入和服务级管理。",
        settingsBackup: "设置备份",
        settingsBackupDetail: "导出非密钥系统设置。",
        resetSection: "重置分区",
        resetSectionDetail: "恢复一个设置区域的默认值。",
        schemaStatus: "Schema 状态",
        schemaStatusDetail: "数据库迁移可见性。"
      }
    }
  },
  preview: {
    loading: "正在加载预览...",
    chooseFile: "选择可预览文件。",
    cannotPreview: "{{size}} 无法内联预览。",
    tooLarge: "此文件大小为 {{size}}。当前预览上限是 {{limit}}，因此未打开。",
    truncated: "预览已截断",
    modeAria: "文本预览模式",
    modes: {
      rendered: "渲染",
      table: "表格",
      source: "源码"
    },
    kind: {
      directory: "目录",
      text: "文本",
      image: "图片",
      audio: "音频",
      video: "视频",
      pdf: "PDF",
      unsupported: "不支持"
    },
    column: "列 {{index}}",
    tableTruncated: "显示 {{rows}} / {{totalRows}} 行，{{columns}} / {{totalColumns}} 列。"
  },
  files: {
    labels: {
      archive: "归档",
      audio: "音频",
      blocked: "已阻止",
      code: "代码",
      config: "配置",
      database: "数据库",
      directory: "文件夹",
      document: "文档",
      font: "字体",
      image: "图片",
      json: "JSON",
      markdown: "Markdown",
      other: "文件",
      package: "包",
      pdf: "PDF",
      secure: "密钥",
      shell: "脚本",
      spreadsheet: "表格",
      symlink: "链接",
      text: "文本",
      video: "视频"
    }
  }
} satisfies LocaleResource<typeof en>;

export const resources = {
  en: {
    translation: en
  },
  "zh-CN": {
    translation: zhCN
  }
} as const;
