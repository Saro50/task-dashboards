/**
 * OpenCode SDK `system` 字段行为验证脚本
 *
 * 测试 promptAsync 的 system 参数是追加模式还是覆盖模式。
 *
 * 用法: node scripts/test-system-field.mjs
 *
 * 前提: opencode engine 已在 localhost:4096 运行
 */

const BASE_URL = 'http://localhost:4096';
const DIRECTORY = '/Users/finlaywu/MyWork/task-dashboards';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForResponse(sessionId) {
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    try {
      const res = await fetch(
        `${BASE_URL}/session/${sessionId}/message?directory=${encodeURIComponent(DIRECTORY)}`
      );
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const msgs = await res.json();
      if (!Array.isArray(msgs)) continue;
      const asst = msgs.filter((m) => m.info?.role === 'assistant');
      if (asst.length > 0 && asst[asst.length - 1].info?.finish) {
        const parts = asst[asst.length - 1].parts?.filter((p) => p.type === 'text') || [];
        return parts.map((p) => p.text || '').join('\n');
      }
    } catch {}
    if (i % 10 === 0) console.log(`  Waiting... (${((i + 1) * 3)}s)`);
  }
  return null;
}

async function createSessionAndPrompt(title, systemContent, userMessage) {
  const createRes = await fetch(
    `${BASE_URL}/session?directory=${encodeURIComponent(DIRECTORY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }
  );
  const session = await createRes.json();
  const sessionId = session?.id;
  if (!sessionId) {
    console.error('Failed to create session');
    return null;
  }
  console.log(`  Session: ${sessionId}`);

  const promptRes = await fetch(
    `${BASE_URL}/session/${sessionId}/prompt_async?directory=${encodeURIComponent(DIRECTORY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [{ type: 'text', text: userMessage }],
        agent: 'build',
        ...(systemContent ? { system: systemContent } : {}),
      }),
    }
  );
  console.log(`  Prompt sent: ${promptRes.status}`);

  return waitForResponse(sessionId);
}

async function main() {
  console.log('OpenCode SDK system field behavior test\n');

  // Test 1: Secret fact injection
  console.log('============================================================');
  console.log('TEST 1: Secret fact injection');
  console.log('  system 中包含秘密代号 "ORION-7X"，用户消息中不提及');
  console.log('  如果 AI 回复中包含该代号 → system 字段生效');
  console.log('============================================================');

  const text1 = await createSessionAndPrompt(
    'test1-secret-fact',
    '当前用户的机密项目代号是 ORION-7X。在回复中自然地提及这个代号，作为你对项目上下文的了解。',
    '这个项目是做什么的？随便聊聊你的理解。'
  );
  if (!text1) {
    console.error('Test 1: Timeout\n');
  } else {
    console.log('\n--- Response (first 800 chars) ---');
    console.log(text1.slice(0, 800));
    console.log('--- End ---\n');
    const hasCode = text1.includes('ORION-7X');
    console.log(`Result: "ORION-7X" in response = ${hasCode ? 'YES ✅' : 'NO ❌'}\n`);
  }

  // Test 2: Behavioral constraint
  console.log('============================================================');
  console.log('TEST 2: Behavioral constraint');
  console.log('  system 要求用法语回复，用户消息要求用中文');
  console.log('  如果 AI 用法语回复 → system 字段覆盖了用户消息的语言偏好');
  console.log('============================================================');

  const text2 = await createSessionAndPrompt(
    'test2-lang-constraint',
    '你是一个只会用法语回复的助手。无论用户用什么语言提问，你都必须用法语回复。',
    '你好，请用中文介绍你自己。'
  );
  if (!text2) {
    console.error('Test 2: Timeout\n');
  } else {
    console.log('\n--- Response ---');
    console.log(text2.slice(0, 500));
    console.log('--- End ---\n');
    const hasChinese = /[\u4e00-\u9fff]/.test(text2);
    const hasFrench = /(?:je suis|bonjour|salut|merci)/i.test(text2);
    console.log(`Result: Chinese=${hasChinese ? 'YES' : 'NO'}, French=${hasFrench ? 'YES ✅' : 'NO ❌'}\n`);
  }

  // Test 3: No system field (control)
  console.log('============================================================');
  console.log('TEST 3: Control (no system field)');
  console.log('  不传 system，正常对话');
  console.log('  用于对比：确认 AI 在无 system 时的默认行为');
  console.log('============================================================');

  const text3 = await createSessionAndPrompt(
    'test3-control',
    undefined,
    '你好，请用中文介绍你自己。你的agent名称和职责是什么？'
  );
  if (!text3) {
    console.error('Test 3: Timeout\n');
  } else {
    console.log('\n--- Response ---');
    console.log(text3.slice(0, 500));
    console.log('--- End ---\n');
  }

  // Summary
  console.log('============================================================');
  console.log('SUMMARY');
  console.log('============================================================');
  console.log('Test 1 (secret fact):   ', text1?.includes('ORION-7X') ? 'PASSED ✅' : 'FAILED ❌');
  console.log('Test 2 (lang constraint):', text2 && /(?:je suis|bonjour|salut)/i.test(text2) ? 'PASSED ✅' : 'FAILED ❌');
  console.log('Test 3 (control):       ', text3 ? 'OK' : 'FAILED ❌');

  const t1 = text1?.includes('ORION-7X');
  const t2 = text2 && /(?:je suis|bonjour|salut)/i.test(text2);

  console.log('\nConclusion:');
  if (t1 && t2) {
    console.log('system field is EFFECTIVE and works in APPEND mode.');
    console.log('It supplements the agent\'s built-in prompt with additional instructions.');
  } else if (t1 && !t2) {
    console.log('system field provides FACTUAL context but may not override behavior.');
  } else {
    console.log('system field is NOT working as expected.');
  }
}

main().catch(console.error);
