(() => {
  'use strict';

  const TOOL_SCHEMAS = [
    {
      type: 'function',
      function: {
        name: 'launch_app',
        description: 'Open any Apex Ecosystem app window by appId.',
        parameters: {
          type: 'object',
          properties: { appId: { type: 'string', description: 'The app id to launch (e.g. apex-notes, apex-drive, apex-settings, apex-ai).' } },
          required: ['appId'],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: 'function',
      function: {
        name: 'close_app',
        description: 'Close an open app window by appId.',
        parameters: {
          type: 'object',
          properties: { appId: { type: 'string', description: 'The app id to close.' } },
          required: ['appId'],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: 'function',
      function: {
        name: 'save_note',
        description: 'Create or update a note in IndexedDB Apex Notes.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title. If a note with the same title exists, it is updated.' },
            body: { type: 'string', description: 'Note body/content.' }
          },
          required: ['title', 'body'],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List all stored files and notes in IndexedDB Apex Drive/Notes.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: true
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a stored file or note by id (or name). User confirmation is required before deletion.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'The file/note id (or name/title) to delete.' } },
          required: ['id'],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_ui_mode',
        description: 'Switch between desktop and mobile OS layouts.',
        parameters: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['desktop', 'mobile'], description: 'Target UI mode.' } },
          required: ['mode'],
          additionalProperties: false
        },
        strict: true
      }
    }
  ];

  const SYSTEM_PROMPT = `You are Apex Agent, the built-in assistant for ApexOS.
Use a ReAct-style loop. You can think and call tools to complete the user's request.
Available tools: launch_app(appId), close_app(appId), save_note(title, body), list_files(), delete_file(id), set_ui_mode(mode).
Respond ONLY with a single JSON object (no markdown fences) in one of these forms:
1) Tool call: {"thought":"brief reasoning","tool_call":{"name":"tool_name","arguments":{...}}}
2) Final answer: {"thought":"brief reasoning","final":"user-facing answer"}
Rules:
- Use tool calls when an action or local data is needed. Wait for observations before claiming results.
- For delete_file, call the tool; the system will show a 1-tap user confirmation prompt before deleting.
- launch_app accepts app ids like apex-ai, apex-notes, apex-drive, apex-settings, apex-studio, apex-editor, apex-browser, etc.
- set_ui_mode accepts "desktop" or "mobile".
- Keep answers concise and factual. If a request is unsupported, explain briefly in final.`;

  const messagesEl = () => document.getElementById('agent-messages');
  const inputEl = () => document.getElementById('agent-input');
  const indicatorEl = () => document.getElementById('agent-mode-indicator');

  let busy = false;
  let recognition = null;

  function addMsg(role, text) {
    const el = messagesEl(); if (!el) return;
    const div = document.createElement('div');
    div.className = 'msg ' + (role || 'agent');
    div.textContent = text;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  function getSettings() {
    const st = window.ApexOS && window.ApexOS.getState ? window.ApexOS.getState() : null;
    return st ? st.settings : { agentPrimary: {}, agentFallback: {} };
  }

  function isOnlineConfigured(p) {
    return !!(navigator.onLine && p && p.endpoint && p.apiKey);
  }

  function updateModeIndicator() {
    const el = indicatorEl(); if (!el) return;
    const s = getSettings();
    if (!navigator.onLine) {
      el.textContent = 'Offline · deterministic parser (no network)';
    } else if (isOnlineConfigured(s.agentPrimary) || isOnlineConfigured(s.agentFallback)) {
      el.textContent = 'Online · ReAct tool loop (OpenAI-compatible)';
    } else {
      el.textContent = 'Online (no API key) · deterministic parser fallback';
    }
  }

  // ---------- Tool execution ----------
  async function executeTool(name, args) {
    const A = window.ApexOS;
    if (!A) return { error: 'ApexOS API unavailable' };
    try {
      switch (name) {
        case 'launch_app': {
          const ok = A.launchApp(String(args.appId || ''));
          return { ok, appId: args.appId };
        }
        case 'close_app': {
          const ok = A.closeApp(String(args.appId || ''));
          return { ok, appId: args.appId };
        }
        case 'save_note': {
          const res = await A.saveNote(args.title || 'Untitled', args.body || '');
          return { ok: true, ...res };
        }
        case 'list_files': {
          const files = await A.listFiles();
          return { ok: true, count: files.length, files };
        }
        case 'delete_file': {
          const res = await A.deleteFile(String(args.id || ''));
          return res;
        }
        case 'set_ui_mode': {
          const mode = args.mode === 'mobile' ? 'mobile' : 'desktop';
          const applied = A.setUIMode(mode);
          return { ok: true, mode: applied };
        }
        default:
          return { error: `Unknown tool: ${name}` };
      }
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }

  // ---------- Offline deterministic parser ----------
  function findAppByQuery(q) {
    const apps = window.ApexOS ? window.ApexOS.getApps() : [];
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nq = norm(q);
    if (!nq) return null;
    // exact id
    let app = apps.find(a => a.id === nq || a.id === q);
    if (app) return app;
    // by name contains
    app = apps.find(a => norm(a.name) === nq) || apps.find(a => norm(a.name).includes(nq)) || apps.find(a => nq.includes(norm(a.name)));
    if (app) return app;
    // token match on id
    app = apps.find(a => norm(a.id.replace('apex-', '')).includes(nq.replace('apex ', '')));
    return app || null;
  }

  async function runOfflineParser(input) {
    const text = String(input || '').trim();
    const lower = text.toLowerCase();

    // set/switch mode
    if (/\b(desktop|laptop)\b/.test(lower) && /\b(mode|switch|set|ui|layout|use|go)\b/.test(lower)) {
      const r = await executeTool('set_ui_mode', { mode: 'desktop' });
      return `Switched UI mode to desktop.`;
    }
    if (/\b(mobile|android|phone)\b/.test(lower) && /\b(mode|switch|set|ui|layout|use|go)\b/.test(lower)) {
      const r = await executeTool('set_ui_mode', { mode: 'mobile' });
      return `Switched UI mode to mobile (Android).`;
    }

    // close app
    let m = lower.match(/\b(close|quit|exit)\b\s+(?:app\s+)?(.+)/);
    if (m) {
      const app = findAppByQuery(m[2]);
      if (app) { await executeTool('close_app', { appId: app.id }); return `Closed ${app.name}.`; }
      return `I couldn't find an app matching "${m[2].trim()}" to close.`;
    }

    // launch/open app
    m = lower.match(/\b(open|launch|start|run|show)\b\s+(?:app\s+)?(.+)/);
    if (m) {
      const q = m[2].replace(/\b(app|window)\b/g, '').trim();
      const app = findAppByQuery(q);
      if (app) { await executeTool('launch_app', { appId: app.id }); return `Launched ${app.name}.`; }
      return `I couldn't find an app matching "${q}". Try "open Apex Notes", "open Apex Drive", or "open Apex Settings".`;
    }

    // list files/notes
    if (/\b(list|show|what)\b.*\b(files|notes|drive|storage)\b/.test(lower) || lower === 'list files' || lower === 'list notes') {
      const r = await executeTool('list_files', {});
      if (!r.ok) return `Could not list files: ${r.error || 'unknown error'}`;
      if (!r.files.length) return 'No stored files or notes found in IndexedDB.';
      const lines = r.files.slice(0, 20).map(f => `- [${f.kind}] ${f.name} (id: ${f.id}, ${f.sizeLabel || ''})`);
      return `Stored items (${r.count}):\n${lines.join('\n')}${r.count > 20 ? '\n…' : ''}`;
    }

    // delete file/note
    m = text.match(/\b(delete|remove)\b\s+(?:file|note)?\s*[:#]?\s*(.+)/i);
    if (m) {
      const target = m[2].trim().replace(/^['"]|['"]$/g, '');
      if (!target) return 'Please specify which file or note to delete (id or name).';
      const r = await executeTool('delete_file', { id: target });
      if (r.ok) return `Deleted ${r.kind} "${r.name || target}".`;
      if (r.cancelled) return 'Delete cancelled (confirmation not approved).';
      return `Could not delete: ${r.error || 'not found'}.`;
    }

    // save note: "save note Title: body" or "create note titled X body Y"
    m = text.match(/\b(?:save|create|add|make)\b\s+(?:a\s+)?note\s+(?:titled\s+|called\s+|named\s+)?["“]?([^:"]+)["”]?\s*[:\-]\s*([\s\S]+)/i);
    if (m) {
      const r = await executeTool('save_note', { title: m[1].trim(), body: m[2].trim() });
      return r.ok ? `${r.updated ? 'Updated' : 'Created'} note "${r.title}" in Apex Notes.` : `Could not save note: ${r.error || 'error'}`;
    }
    m = text.match(/\b(?:save|create|add|make)\b\s+(?:a\s+)?note\s+(?:titled\s+|called\s+|named\s+)?["“]?(.+?)["”]?$/i);
    if (m && !/\b(list|delete|open|launch)\b/.test(lower)) {
      const r = await executeTool('save_note', { title: m[1].trim(), body: '' });
      return r.ok ? `${r.updated ? 'Updated' : 'Created'} note "${r.title}" in Apex Notes.` : `Could not save note: ${r.error || 'error'}`;
    }

    // help
    if (/\b(help|what can you do|commands)\b/.test(lower)) {
      return [
        'Offline commands I can run locally:',
        '- "open/launch <app>" (e.g. open Apex Notes, launch Apex Drive, open Apex Settings)',
        '- "close <app>"',
        '- "switch to mobile/desktop mode"',
        '- "list files" or "list notes"',
        '- "save note Title: body"',
        '- "delete file <id or name>" (asks for 1-tap confirmation)'
      ].join('\n');
    }

    return 'I can run local commands offline: launch/close apps, switch UI mode, save/list/delete notes & files. Try "help" for examples. Configure an online provider in Apex Settings for broader ReAct reasoning.';
  }

  // ---------- Online ReAct loop (OpenAI-compatible) ----------
  async function callProvider(provider, messages) {
    const endpoint = (provider.endpoint || '').trim();
    const apiKey = provider.apiKey || '';
    const model = (provider.model || '').trim() || 'gpt-4o-mini';
    const body = {
      model,
      messages,
      tools: TOOL_SCHEMAS,
      temperature: 0.2
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    return await res.json();
  }

  function parseAssistantAction(data) {
    const choice = data && data.choices && data.choices[0];
    const msg = choice && choice.message ? choice.message : null;
    if (!msg) return { final: 'No response from model.' };
    // Native tool_calls
    if (msg.tool_calls && msg.tool_calls.length) {
      const tc = msg.tool_calls[0];
      const name = tc.function && tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
      return { thought: msg.content || '', tool_call: { name, arguments: args }, raw: msg };
    }
    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    // Try parse JSON ReAct response
    const jsonStr = extractJsonObject(content);
    if (jsonStr) {
      try {
        const obj = JSON.parse(jsonStr);
        if (obj.tool_call && obj.tool_call.name) return obj;
        if (typeof obj.final === 'string') return obj;
        // Some models return {name,args} or {action:...}
        if (obj.name && obj.arguments) return { thought: obj.thought || '', tool_call: { name: obj.name, arguments: obj.arguments } };
      } catch {}
    }
    // Fallback: treat as final
    return { thought: '', final: content || 'Done.' };
  }

  function extractJsonObject(s) {
    if (!s) return null;
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 1);
    return null;
  }

  async function runOnlineReAct(userText) {
    const s = getSettings();
    const providers = [s.agentPrimary, s.agentFallback].filter(p => p && p.endpoint);
    if (!providers.length) throw new Error('No providers configured');
    let providerIndex = 0;
    const convo = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userText }
    ];
    const maxSteps = 6;
    for (let step = 0; step < maxSteps; step++) {
      let data = null;
      let advanced = false;
      while (providerIndex < providers.length) {
        const p = providers[providerIndex];
        if (!p.apiKey) { providerIndex++; continue; }
        try {
          data = await callProvider(p, convo);
          break;
        } catch (e) {
          if (e && e.status === 429) {
            addMsg('system', `Provider returned HTTP 429. Trying fallback provider...`);
            providerIndex++;
            advanced = true;
            continue;
          }
          if (!navigator.onLine) throw e;
          // network/other error: try next provider if available
          if (providerIndex < providers.length - 1) {
            addMsg('system', `Provider error (${e.status || 'network'}). Trying fallback provider...`);
            providerIndex++;
            advanced = true;
            continue;
          }
          throw e;
        }
      }
      if (!data) throw new Error('No available online provider (missing API keys or all failed).');

      const action = parseAssistantAction(data);
      if (action.thought) {
        // optional: show compact thought as system in dev? keep UI clean, skip or minimal
      }
      if (action.tool_call && action.tool_call.name) {
        const { name, arguments: args } = action.tool_call;
        addMsg('system', `Tool: ${name}(${JSON.stringify(args || {})})`);
        const obs = await executeTool(name, args || {});
        // append assistant tool-call intent and observation for next turn
        convo.push({ role: 'assistant', content: JSON.stringify({ thought: action.thought || '', tool_call: action.tool_call }) });
        convo.push({ role: 'user', content: `Observation: ${JSON.stringify(obs)}` });
        continue;
      }
      return action.final || 'Done.';
    }
    return 'Reached the step limit. Please try a more specific request.';
  }

  async function handleUserInput(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || busy) return;
    addMsg('user', trimmed);
    busy = true;
    inputEl().value = '';
    try {
      const s = getSettings();
      const canOnline = navigator.onLine && (isOnlineConfigured(s.agentPrimary) || isOnlineConfigured(s.agentFallback));
      let answer;
      if (canOnline) {
        try {
          answer = await runOnlineReAct(trimmed);
        } catch (e) {
          // automatic fallback to offline deterministic parser if online path fails
          addMsg('system', `Online agent unavailable (${e && e.message ? e.message : 'error'}). Falling back to local deterministic parser.`);
          answer = await runOfflineParser(trimmed);
        }
      } else {
        answer = await runOfflineParser(trimmed);
      }
      addMsg('agent', answer);
    } catch (e) {
      addMsg('agent', `Error: ${e && e.message ? e.message : String(e)}`);
    } finally {
      busy = false;
      updateModeIndicator();
    }
  }

  // ---------- Voice input ----------
  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = document.getElementById('agent-voice-btn');
    if (!btn) return;
    if (!SR) {
      btn.title = 'Voice input not supported in this browser';
      btn.disabled = true;
      btn.style.opacity = '0.5';
      return;
    }
    recognition = new SR();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const t = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
      if (t) {
        inputEl().value = t;
        handleUserInput(t);
      }
    };
    recognition.onerror = () => { btn.classList.remove('active'); };
    recognition.onend = () => { btn.classList.remove('active'); btn.textContent = '🎤'; };
    btn.onclick = () => {
      try {
        btn.classList.add('active');
        btn.textContent = '🎙️';
        recognition.start();
      } catch {
        btn.classList.remove('active');
        btn.textContent = '🎤';
      }
    };
  }

  function bind() {
    const form = document.getElementById('agent-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleUserInput(inputEl().value);
      });
    }
    setupVoice();
    updateModeIndicator();
    window.addEventListener('online', updateModeIndicator);
    window.addEventListener('offline', updateModeIndicator);
    addMsg('system', 'Apex Agent ready. I can launch/close apps, switch UI mode, and manage offline notes/files. Use voice or text. Online mode uses your configured OpenAI-compatible provider when available.');
  }

  window.ApexAgent = { updateModeIndicator, handleUserInput };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
