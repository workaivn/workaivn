import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createReactWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-reasoning-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'workai-reasoning-app',
    version: '1.0.0',
    packageManager: 'npm@10.8.2',
    scripts: {
      build: 'node -e "console.log(\\"BUILD_OK\\")"'
    },
    dependencies: {
      '@vitejs/plugin-react': 'latest',
      vite: 'latest',
      react: 'latest',
      'react-dom': 'latest'
    },
    devDependencies: {}
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(root, 'src', 'App.js'), 'export default function App() { return null; }\n', 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('Phase 4.15: REASONING task generates execution tasks before WRITE_FILE and RUN_TERMINAL', async () => {
  const root = await createReactWorkspace();
  const prompt = `Create a simple landing page for WorkAIVN with:

Hero
Subtitle
Three cards
CTA

Use the existing React application.

Run:
npm run build`;

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 40,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
            files: [
              {
                path: 'src/App.js',
                content: `import './styles.css';
import { features } from './features.js';
import { Hero } from './Hero.js';
import { FeatureCard } from './FeatureCard.js';
import { CtaButton } from './CtaButton.js';

export default function App() {
  return (
    <main className="landing-page">
      <Hero />
      <section className="feature-grid">
        {features.map((feature) => <FeatureCard key={feature.title} feature={feature} />)}
      </section>
      <CtaButton />
    </main>
  );
}
`
              },
              { path: 'src/features.js', content: `export const features = [
  { title: 'AI Agents', body: 'Coordinate coding work with real project context.' },
  { title: 'Workspace Safety', body: 'Keep edits inside the selected repository.' },
  { title: 'Quality Gates', body: 'Validate every run before calling it complete.' }
];
` },
              { path: 'src/Hero.js', content: `export function Hero() {
  return (
    <section className="hero">
      <p className="eyebrow">WorkAIVN Agent Hub</p>
      <h1>Build faster with project-aware AI agents</h1>
      <p className="subtitle">WorkAIVN turns your selected workspace into a safe, inspectable coding environment.</p>
    </section>
  );
}
` },
              { path: 'src/FeatureCard.js', content: `export function FeatureCard({ feature }) {
  return (
    <article className="feature-card">
      <h2>{feature.title}</h2>
      <p>{feature.body}</p>
    </article>
  );
}
` },
              { path: 'src/CtaButton.js', content: `export function CtaButton() {
  return <a className="cta-button" href="#start">Start building with WorkAIVN</a>;
}
` },
              { path: 'src/styles.css', content: `.landing-page { min-height: 100vh; padding: 64px; font-family: Inter, system-ui, sans-serif; background: #07111f; color: white; }
.hero { max-width: 880px; margin: 0 auto 48px; text-align: center; }
.eyebrow { color: #7dd3fc; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; }
.hero h1 { font-size: clamp(2.5rem, 6vw, 5rem); margin: 16px 0; }
.subtitle { color: #cbd5e1; font-size: 1.25rem; }
.feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; max-width: 1080px; margin: 0 auto 40px; }
.feature-card { border: 1px solid rgba(125, 211, 252, .25); border-radius: 24px; padding: 24px; background: rgba(15, 23, 42, .75); }
.cta-button { display: block; width: fit-content; margin: 0 auto; padding: 16px 24px; border-radius: 999px; background: #38bdf8; color: #082f49; font-weight: 800; text-decoration: none; }
` },
              { path: 'src/theme.js', content: `export const theme = {
  primary: '#38bdf8',
  background: '#07111f',
  text: '#ffffff'
};
` },
              { path: 'src/landingCopy.js', content: `export const landingCopy = {
  title: 'Build faster with project-aware AI agents',
  subtitle: 'Safe workspace execution for WorkAIVN teams.'
};
` }
            ]
          });
        }
        if (promptText.includes('Generate ONLY the file content') || promptText.includes('Return JSON: {"content":"..."}')) {
          return JSON.stringify({ content: 'export default function App() { return null; }' });
        }
        return JSON.stringify({ done: true, final: 'fallback' });
      }
    });

    assert.equal(result.success, true, JSON.stringify(result.qualityGate, null, 2));
    assert.equal(result.status, 'completed');
    assert.equal(result.qualityGate?.passed, true);

    assert.ok(result.toolCalls.some(c => c.tool === 'WRITE_FILE' && c.args?.path === 'src/App.js'), 'Expected WRITE_FILE src/App.js');
    assert.ok(result.toolCalls.some(c => c.tool === 'RUN_TERMINAL' && c.args?.command === 'npm run build' && c.success), 'Expected successful npm run build');
    assert.ok(!result.toolCalls.some(c => String(c.error || c.result?.error || '').includes('Unknown tool: null')), 'No Unknown tool: null');
    assert.equal(result.events.some(e => e.type === 'planner_reasoning_start'), false);
    assert.equal(result.events.some(e => e.type === 'planner_reasoning_complete'), false);

    const appContent = await fs.readFile(path.join(root, 'src', 'App.js'), 'utf8');
    assert.match(appContent, /export default function App/);
    const buildCall = result.toolCalls.find(c => c.tool === 'RUN_TERMINAL' && c.args?.command === 'npm run build');
    assert.match(String(buildCall?.result?.stdout || ''), /BUILD_OK/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
