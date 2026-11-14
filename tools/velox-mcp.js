#!/usr/bin/env node
// VELOX Studio MCP server (stdio). Lets Claude (Claude Code / Claude Desktop) operate the running editor.
// Register:  claude mcp add velox -- node "C:\Users\<you>\Desktop\VELOX Studio\tools\velox-mcp.js"
// It talks to the app's local automation API (127.0.0.1, token in %APPDATA%\velox-studio\api.json).
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const CFG = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'velox-studio', 'api.json');

function api(method, route, body) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return Promise.reject(new Error('VELOX Studio läuft nicht (api.json fehlt). Bitte die App starten.')); }
  const data = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: route, method, headers: { 'x-velox-token': cfg.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: 3600_000 }, (res) => {
      let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { try { const j = JSON.parse(s); res.statusCode >= 400 ? reject(new Error(j.error || s)) : resolve(j); } catch { reject(new Error(s)); } });
    });
    req.on('error', (e) => reject(new Error('VELOX Studio nicht erreichbar: ' + e.message)));
    req.end(data);
  });
}

const TOOLS = [
  { name: 'velox_state', description: 'Current project state of VELOX Studio: settings, tracks, media pool, clips (with ids, times, effects), transitions, markers, playhead, selection.', inputSchema: { type: 'object', properties: {} } },
  { name: 'velox_commands', description: 'List every editor command id with its arguments. All menu actions, tools, AI functions and automation helpers are commands.', inputSchema: { type: 'object', properties: {} } },
  { name: 'velox_catalog', description: 'List available effects (with params), transitions, presets and velocity presets.', inputSchema: { type: 'object', properties: {} } },
  { name: 'velox_run', description: 'Run one editor command, e.g. {command:"split"}, {command:"seek",args:{t:3.5}}, {command:"applyEffect",args:{type:"realism",clipIds:["clp_x"]}}, {command:"addTransition",args:{type:"whippan",a:"clp_a",b:"clp_b"}}, {command:"autoEdit",args:{style:"montage"}}, {command:"renderVideo",args:{out:"C:/x.mp4",height:2160}}.', inputSchema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'object' } }, required: ['command'] } },
  { name: 'velox_batch', description: 'Run several commands in order: {steps:[{command,args},...]}.', inputSchema: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'object' } }, required: ['command'] } } }, required: ['steps'] } },
  { name: 'velox_import', description: 'Import media files. place: "none" (pool only), "append" (end of main track) or "at" (time t).', inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, place: { type: 'string', enum: ['none', 'append', 'at'] }, t: { type: 'number' } }, required: ['files'] } },
  { name: 'velox_frame', description: 'Render the frame at time t (seconds) exactly as it will be exported and return it as an image, so you can look at the edit.', inputSchema: { type: 'object', properties: { t: { type: 'number' } } } },
  { name: 'velox_set_project', description: 'Replace the whole project JSON (advanced; get it via velox_state/GET project first).', inputSchema: { type: 'object', properties: { project: { type: 'object' } }, required: ['project'] } },
];

async function callTool(name, a = {}) {
  switch (name) {
    case 'velox_state': return text(await api('GET', '/state'));
    case 'velox_commands': return text(await api('GET', '/commands'));
    case 'velox_catalog': return text(await api('GET', '/catalog'));
    case 'velox_run': return text(await api('POST', '/run', { command: a.command, args: a.args || {} }));
    case 'velox_batch': return text(await api('POST', '/batch', { steps: a.steps || [] }));
    case 'velox_import': return text(await api('POST', '/import', { files: a.files, place: a.place || 'none', t: a.t }));
    case 'velox_set_project': return text(await api('POST', '/project', { project: a.project }));
    case 'velox_frame': {
      const r = await api('POST', '/frame', { t: a.t });
      const b64 = fs.readFileSync(r.file).toString('base64');
      try { fs.unlinkSync(r.file); } catch {}
      return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] };
    }
    default: throw new Error('unknown tool ' + name);
  }
}
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });

// ---- minimal JSON-RPC over stdio (newline delimited)
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); } });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
async function handle(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'velox-studio', version: '0.1.0' } } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      try { return send({ jsonrpc: '2.0', id, result: await callTool(params.name, params.arguments) }); }
      catch (e) { return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(e.message || e) }] } }); }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message || e) } }); }
}
