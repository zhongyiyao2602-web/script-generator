// Cloudflare Pages Functions 格式
// 文件位于 functions/api/generate.js，自动映射到 /api/generate

export async function onRequestPost({ request, env }) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { product, pain, audience, techniques } = await request.json();

    if (!product || !product.name) {
      return jsonResponse(400, { error: '缺少产品信息' });
    }
    if (!pain || !pain.name) {
      return jsonResponse(400, { error: '缺少痛点信息' });
    }
    if (!audience || !audience.label) {
      return jsonResponse(400, { error: '缺少人群信息' });
    }

    // Cloudflare Pages 环境变量通过 env 获取
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return jsonResponse(500, { error: '服务器未配置 DEEPSEEK_API_KEY 环境变量' });
    }

    // Build technique descriptions
    const techList = [];
    Object.keys(techniques || {}).forEach(cat => {
      (techniques[cat] || []).forEach(t => {
        techList.push(t.name + '（' + t.desc + '）');
      });
    });
    const techStr = techList.length ? techList.join('；') : '不限手法，自行选择最合适的';

    const systemPrompt = [
      '你是一位专业的带货短视频脚本文案，擅长根据痛点、人群和创意手法撰写投流带货脚本。',
      '',
      '规则：',
      '1. 输出必须是 JSON 格式，包含 5 个模块：hook（开头钩子）、amplify（痛点放大）、product（产品引入）、trust（信任背书）、cta（CTA收尾）',
      '2. 每个模块是一段完整的文案，字数控制在 50-150 字',
      '3. 语言风格贴合目标人群特征',
      '4. 合规要求：不使用绝对化用语（最好/最强/第一等）、不做功效承诺（包治/根治等）、CTA不强推（不使用闭眼入/赶紧抢等）',
      '5. 如果合规模式为 OTC，CTA 模块末尾必须加上"请按药品说明书或在药师指导下购买和使用"',
      '',
      '输出格式（严格 JSON，不要 markdown 代码块）：',
      '{"hook":"...","amplify":"...","product":"...","trust":"...","cta":"..."}',
    ].join('\n');

    const userPrompt = [
      '请根据以下信息撰写脚本：',
      '',
      '【产品信息】',
      '名称：' + product.name,
      '品类：' + (product.category || '未指定'),
      '核心卖点：' + ((product.sellingPoints || []).join('、') || '未指定'),
      '使用场景：' + (product.scenarios || '未指定'),
      '合规模式：' + (product.compliance === 'otc' ? 'OTC（药品）' : '非OTC（普通商品）'),
      '',
      '【痛点】',
      '名称：' + pain.name,
      '触发场景：' + (pain.scene || '未指定'),
      '连锁后果：' + (pain.consequence || '未指定'),
      '情绪触发词：' + (pain.emotion || '未指定'),
      '对应卖点：' + (pain.sellingPoint || '未指定'),
      '',
      '【目标人群】',
      '标签：' + audience.label,
      '行为特征：' + (audience.behavior || '未指定'),
      '信任驱动：' + (audience.trust || '未指定'),
      '语言风格：' + (audience.style || '口语化'),
      '',
      '【指定手法】',
      techStr,
      '',
      '请严格按照 JSON 格式输出 5 个模块的脚本内容。',
    ].join('\n');

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('DeepSeek API error:', response.status, errText);
      return jsonResponse(502, { error: 'AI 服务返回错误 (' + response.status + ')' });
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!content) {
      return jsonResponse(502, { error: 'AI 未返回有效内容' });
    }

    // Parse JSON from AI response
    let cleaned = content.trim();
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

    let modules;
    try {
      modules = JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        modules = JSON.parse(match[0]);
      } else {
        return jsonResponse(502, { error: 'AI 返回内容无法解析为 JSON', raw: content });
      }
    }

    const requiredKeys = ['hook', 'amplify', 'product', 'trust', 'cta'];
    for (const key of requiredKeys) {
      if (!modules[key] || typeof modules[key] !== 'string') {
        return jsonResponse(502, { error: 'AI 返回内容缺少模块: ' + key });
      }
    }

    const result = [
      { key: 'hook', label: '开头钩子', content: modules.hook },
      { key: 'amplify', label: '痛点放大', content: modules.amplify },
      { key: 'product', label: '产品引入', content: modules.product },
      { key: 'trust', label: '信任背书', content: modules.trust },
      { key: 'cta', label: 'CTA收尾', content: modules.cta },
    ];

    return jsonResponse(200, { modules: result });
  } catch (err) {
    console.error('Server error:', err);
    return jsonResponse(500, { error: '服务器内部错误: ' + (err.message || 'unknown') });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
