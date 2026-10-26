// 社内の管理画面（デモ用のモックアップ）の動き。
//
// 擬似のもの: 画面の切り替え、「AI に〜させる」ボタン（2秒待って用意済みの文書を見せるだけ）、
//             録音と文字起こしのアップロード、顧客管理への登録。AI もデータベースも使いません。
// QA の確認は、この画面ではなく、お客さんの画面（マージ前は http://localhost:4173/pr/ ）で行います。

const AI_WAIT_MS = 2000;

// --- 画面の切り替え（工程の帯の 1・2・5 を押す） --------------------------

const processSteps = [...document.querySelectorAll('.process__step')];
const screens = processSteps
  .filter((step) => step.dataset.screen)
  .map((step) => step.dataset.screen);

function showScreen(name) {
  const target = screens.includes(name) ? name : 'crm';
  for (const screen of screens) {
    document.getElementById(`screen-${screen}`).hidden = screen !== target;
  }
  for (const step of processSteps) {
    if (step.dataset.screen === target) {
      step.setAttribute('aria-current', 'step');
    } else {
      step.removeAttribute('aria-current');
    }
  }
}

window.addEventListener('hashchange', () => showScreen(window.location.hash.slice(1)));
showScreen(window.location.hash.slice(1));

// --- 「AI に〜させる」（擬似） ---------------------------------------------

function pseudoAi(buttonId, workingId, docId, onDone = () => {}) {
  const button = document.getElementById(buttonId);
  const working = document.getElementById(workingId);
  const doc = document.getElementById(docId);
  button.addEventListener('click', () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    doc.hidden = true;
    working.hidden = false;
    setTimeout(() => {
      working.hidden = true;
      doc.hidden = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      onDone();
    }, AI_WAIT_MS);
  });
}

pseudoAi('agenda-button', 'agenda-working', 'agenda-doc');
pseudoAi('minutes-button', 'minutes-working', 'minutes-doc', () => {
  document.getElementById('register-actions').hidden = false;
});

// --- 録音と文字起こしのアップロード（擬似） -------------------------------
// 1.5秒待ってから、用意しておいたファイルを「アップロード済み」として見せる。
// アップロードが済むまで、「AI に議事録を作らせる」は押せない。

const UPLOAD_WAIT_MS = 1500;
const uploadButton = document.getElementById('upload-button');
const uploadWorking = document.getElementById('upload-working');
const uploadResult = document.getElementById('upload-result');
const minutesButton = document.getElementById('minutes-button');

uploadButton.addEventListener('click', () => {
  uploadButton.disabled = true;
  uploadButton.setAttribute('aria-busy', 'true');
  uploadWorking.hidden = false;
  setTimeout(() => {
    uploadButton.removeAttribute('aria-busy');
    // 押し終えたボタンは消す。押せないボタンを残すと、カーソルの形がデモの邪魔になるため
    uploadButton.hidden = true;
    uploadWorking.hidden = true;
    uploadResult.hidden = false;
    minutesButton.disabled = false;
  }, UPLOAD_WAIT_MS);
});

// --- 顧客管理への登録（擬似） ---------------------------------------------
// 議事録から整えたお客さんの声（7件目）を、表に足して見せる。

document.getElementById('register-button').addEventListener('click', (event) => {
  const newRow = document.getElementById('voice-new');
  newRow.hidden = false;
  document.getElementById('voice-count').textContent = '7';
  document.getElementById('register-done').textContent = 'お客さんの声の7件目として登録しました';
  event.currentTarget.hidden = true;
  newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
pseudoAi('prd-button', 'prd-working', 'prd-doc');
