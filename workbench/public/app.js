// 企画のワークベンチの画面側。サーバ（workbench/server.mjs）にファイル名を送り、
// AI が書いた文書を受け取って表示する。ライブラリは使わない。

const $ = (id) => document.getElementById(id);

// ---- 共通の小さな部品 ----

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '思わぬ失敗が起きました。もう一度押してください。');
  return data;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 見出し・箇条書き・チェックボックス・太字・コードだけを扱う、小さな Markdown の表示。
function renderMarkdown(markdown) {
  const inline = (text) =>
    escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const html = [];
  let list = false;
  let inComment = false;
  const closeList = () => {
    if (list) html.push('</ul>');
    list = false;
  };
  for (const line of String(markdown).split('\n')) {
    // 書き手向けの <!-- --> は表示しない。
    if (inComment || line.trim().startsWith('<!--')) {
      inComment = !line.includes('-->');
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    const numbered = /^\s*(\d{1,2})[.．]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      if (!list) html.push('<ul>');
      list = true;
      const box =
        item[1] === undefined ? '' : `<span class="box">${item[1].trim() ? '☑' : '☐'}</span> `;
      html.push(`<li${box ? ' class="task"' : ''}>${box}${inline(item[2])}</li>`);
    } else if (numbered) {
      // 番号つきの行（決まっていないことの質問など）は、番号をそのまま見せる。
      if (!list) html.push('<ul>');
      list = true;
      html.push(`<li class="num">${numbered[1]}. ${inline(numbered[2])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('\n');
}

// 「AI が書いています…」の表示と経過秒数。止める関数を返す。
function startWaiting(statusEl, message) {
  const started = Date.now();
  const tick = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    statusEl.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(message)}　<strong>${seconds}秒</strong>`;
  };
  statusEl.className = 'status waiting';
  tick();
  const timer = setInterval(tick, 1000);
  return () => {
    clearInterval(timer);
    statusEl.className = 'status';
    statusEl.textContent = '';
  };
}

function showError(statusEl, error) {
  statusEl.className = 'status error';
  statusEl.textContent = error.message;
}

function showDocument(container, file, title) {
  container.innerHTML = `
    <div class="saved">保存先：<code>${escapeHtml(file.path)}</code></div>
    <article class="doc">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}${renderMarkdown(file.content)}</article>`;
}

function showText(container, file, note) {
  container.innerHTML = `
    ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}
    <div class="saved">ファイル：<code>${escapeHtml(file.path)}</code></div>
    <pre class="transcript">${escapeHtml(file.content)}</pre>`;
}

// 押している間はボタンを止め、二重に押されないようにする。
async function withBusy(buttons, statusEl, message, task) {
  buttons.forEach((b) => (b.disabled = true));
  const stop = startWaiting(statusEl, message);
  try {
    await task();
    stop();
  } catch (error) {
    stop();
    showError(statusEl, error);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function fillSelect(select, files, emptyLabel) {
  const current = select.value;
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = files.length ? '（使わない）' : emptyLabel;
  select.append(none);
  for (const file of files) {
    const option = document.createElement('option');
    option.value = file.path;
    option.textContent = file.name;
    select.append(option);
  }
  if (files.some((f) => f.path === current)) select.value = current;
}

// チェックボックスの一覧を作る。前に付けていたチェックは残す。
function fillChecks(
  container,
  files,
  { name, checkedByDefault = false, emptyLabel = 'まだありません' },
) {
  const before = new Map(
    [...container.querySelectorAll('input')].map((input) => [input.value, input.checked]),
  );
  container.innerHTML = '';
  if (files.length === 0) {
    container.innerHTML = `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
    return;
  }
  for (const file of files) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.value = file.path;
    input.checked = before.has(file.path) ? before.get(file.path) : checkedByDefault;
    label.append(input, ` ${file.label || file.name}`);
    container.append(label);
  }
}

const checkedValues = (container) =>
  [...container.querySelectorAll('input:checked')].map((input) => input.value);

// ---- ファイルの一覧 ----

let files = { customer: [], minutes: [], voice: [], hearing: [], prd: [], audio: [] };

async function loadFiles() {
  try {
    const res = await fetch('/api/files');
    files = await res.json();
  } catch {
    // サーバが止まっていても画面は出す。
  }
  const firstLoad = !$('agenda-company').options.length;
  fillSelect($('agenda-company'), files.customer, '（まだありません）');
  fillSelect($('agenda-person'), [...files.customer, ...files.voice], '（まだありません）');
  // 最初に開いたときは、名前から会社情報・担当者情報らしいファイルを選んでおく。
  if (firstLoad) {
    $('agenda-company').value = files.customer.find((f) => f.name.includes('会社'))?.path || '';
    $('agenda-person').value = files.customer.find((f) => f.name.includes('担当'))?.path || '';
  }
  fillChecks($('agenda-minutes'), files.minutes, { name: 'minutes', checkedByDefault: true });
  fillChecks($('agenda-extra'), files.voice, { name: 'extra', checkedByDefault: true });
  fillAudio();
  fillPrdSources();
}

function fillAudio() {
  const select = $('audio-select');
  const current = select.value;
  select.innerHTML = '';
  if (files.audio.length === 0) {
    select.innerHTML = '<option value="">（録音がありません）</option>';
  }
  for (const file of files.audio) {
    const option = document.createElement('option');
    option.value = file.path;
    option.textContent = file.name;
    select.append(option);
  }
  if (files.audio.some((f) => f.path === current)) {
    select.value = current;
  } else {
    // 用意した文字起こし（docs/hearing/<名前>_文字起こし.txt）がある録音を先に選んでおく。
    const stem = (name) => name.replace(/\.[^.]+$/, '');
    const ready = files.audio.find((a) =>
      files.hearing.some((h) => h.name === `${stem(a.name)}_文字起こし.txt`),
    );
    if (ready) select.value = ready.path;
  }
  updatePlayer();
}

function updatePlayer() {
  const path = $('audio-select').value;
  const player = $('audio-player');
  const src = path ? `/api/audio?path=${encodeURIComponent(path)}` : '';
  if (player.getAttribute('src') !== src) {
    if (src) player.setAttribute('src', src);
    else player.removeAttribute('src');
  }
}

// PRD に読ませる資料のまとまり。文字起こしは docs/hearing/ のうちアジェンダ以外。
function fillPrdSources() {
  const groups = [
    { title: '議事録', items: files.minutes, checked: true },
    {
      title: '文字起こし',
      items: files.hearing.filter((f) => !f.name.includes('アジェンダ')),
      checked: false,
    },
    { title: '会員の声・問い合わせ', items: files.voice, checked: true },
    {
      title: 'いまのアプリの機能',
      items: [{ path: 'README.md', name: 'README.md', label: 'アプリの説明（README.md）' }],
      checked: true,
    },
    { title: '会社情報', items: files.customer, checked: false },
  ];
  const root = $('prd-sources');
  for (const group of groups) {
    let box = root.querySelector(`[data-group="${group.title}"]`);
    if (!box) {
      box = document.createElement('div');
      box.className = 'source-group';
      box.dataset.group = group.title;
      box.innerHTML = `<p class="group-title">${escapeHtml(group.title)}</p><div class="checks"></div>`;
      root.append(box);
    }
    fillChecks(box.querySelector('.checks'), group.items, {
      name: 'sources',
      checkedByDefault: group.checked,
    });
  }
}

// ---- ① アジェンダ ----

$('agenda-run').addEventListener('click', () => {
  const button = $('agenda-run');
  withBusy([button], $('agenda-status'), 'AI が書いています…（30秒ほど）', async () => {
    $('agenda-result').innerHTML = '';
    const data = await post('/api/agenda', {
      company: $('agenda-company').value || [],
      person: $('agenda-person').value || [],
      minutes: checkedValues($('agenda-minutes')),
      extra: checkedValues($('agenda-extra')),
    });
    const file = data.files[0];
    if (!file)
      throw new Error('AI は返事をしましたが、アジェンダのファイルが見つかりませんでした。');
    showDocument($('agenda-result'), file);
    await loadFiles();
  });
});

// ---- ② 文字起こしと議事録 ----

let transcriptPath = '';

$('audio-select').addEventListener('change', () => {
  updatePlayer();
  transcriptPath = '';
  $('minutes-run').disabled = true;
});

$('transcribe-run').addEventListener('click', () => {
  const path = $('audio-select').value;
  if (!path) {
    showError($('minutes-status'), new Error('録音を選んでください。'));
    return;
  }
  const buttons = [$('transcribe-run'), $('minutes-run')];
  withBusy(buttons, $('minutes-status'), '文字起こししています…', async () => {
    $('transcript-result').innerHTML = '';
    $('minutes-result').innerHTML = '';
    const data = await post('/api/transcribe', { path });
    transcriptPath = data.path;
    showText($('transcript-result'), data);
  }).then(() => {
    $('minutes-run').disabled = !transcriptPath;
  });
});

$('minutes-run').addEventListener('click', () => {
  const buttons = [$('transcribe-run'), $('minutes-run')];
  withBusy(buttons, $('minutes-status'), 'AI が書いています…（30秒ほど）', async () => {
    $('minutes-result').innerHTML = '';
    const data = await post('/api/minutes', { transcript: transcriptPath });
    const file = data.files[0];
    if (!file) throw new Error('AI は返事をしましたが、議事録のファイルが見つかりませんでした。');
    showDocument($('minutes-result'), file);
    await loadFiles();
    // 新しい議事録を PRD の資料に入れておく。
    const box = document.querySelector(`#prd-sources input[value="${CSS.escape(file.path)}"]`);
    if (box) box.checked = true;
  });
});

// ---- ③ PRD ----

let prdSession = { sessionId: '', path: '', questions: [] };

function showQuestions(questions, reply) {
  const form = $('prd-questions');
  const list = $('prd-question-list');
  list.innerHTML = '';
  if (questions.length === 0) {
    // 質問の形を読み取れなかったときは、AI の返事をそのまま見せる。
    if (reply) list.innerHTML = `<pre class="transcript">${escapeHtml(reply)}</pre>`;
    form.hidden = !reply;
    $('prd-answer').hidden = true;
    return;
  }
  for (const q of questions) {
    const group = document.createElement('fieldset');
    group.className = 'question';
    group.innerHTML = `<legend>${q.no}. ${escapeHtml(q.text)}</legend>`;
    for (const option of q.options) {
      const label = document.createElement('label');
      label.className = 'option';
      label.innerHTML = `<input type="radio" name="q${q.no}" value="${escapeHtml(option.key)}" />
        <span class="key">${escapeHtml(option.key)}</span> ${escapeHtml(option.label)}`;
      group.append(label);
    }
    const reason = document.createElement('input');
    reason.type = 'text';
    reason.className = 'reason';
    reason.name = `r${q.no}`;
    reason.placeholder = '決めた理由（任意）';
    group.append(reason);
    list.append(group);
  }
  form.hidden = false;
  $('prd-answer').hidden = false;
}

$('prd-run').addEventListener('click', () => {
  const buttons = [$('prd-run'), $('prd-answer')];
  withBusy(buttons, $('prd-status'), 'AI が書いています…（30秒ほど）', async () => {
    $('prd-result').innerHTML = '';
    $('prd-questions').hidden = true;
    const data = await post('/api/prd', {
      sources: checkedValues($('prd-sources')),
      request: $('prd-request').value,
    });
    if (!data.prd) throw new Error('AI は返事をしましたが、PRD のファイルが見つかりませんでした。');
    prdSession = { sessionId: data.sessionId, path: data.prd.path, questions: data.questions };
    showDocument($('prd-result'), data.prd);
    showQuestions(data.questions, data.reply);
    await loadFiles();
  });
});

$('prd-questions').addEventListener('submit', (event) => {
  event.preventDefault();
  const answers = {};
  const reasons = {};
  for (const q of prdSession.questions) {
    const picked = document.querySelector(`input[name="q${q.no}"]:checked`);
    if (picked) answers[q.no] = picked.value;
    const reason = document.querySelector(`input[name="r${q.no}"]`);
    if (reason && reason.value.trim()) reasons[q.no] = reason.value.trim();
  }
  if (Object.keys(answers).length === 0) {
    showError($('prd-status'), new Error('答えを1つ以上選んでください。'));
    return;
  }
  const buttons = [$('prd-run'), $('prd-answer')];
  withBusy(
    buttons,
    $('prd-status'),
    'AI が答えを PRD に書き込んでいます…（30秒ほど）',
    async () => {
      const data = await post('/api/prd/answer', {
        sessionId: prdSession.sessionId,
        prdPath: prdSession.path,
        questions: prdSession.questions,
        answers,
        reasons,
      });
      if (!data.prd)
        throw new Error('AI は返事をしましたが、PRD のファイルが見つかりませんでした。');
      showDocument($('prd-result'), data.prd);
      $('prd-result').insertAdjacentHTML(
        'afterbegin',
        '<div class="note">答えを反映しました。</div>',
      );
      // まだ決まっていない質問が残っていれば、続けて答えられるように出し直す。
      prdSession.questions = data.questions || [];
      showQuestions(prdSession.questions, '');
    },
  );
});

loadFiles();
