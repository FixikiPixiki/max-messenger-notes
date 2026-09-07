// ========== ФИКС: ПРИВЯЗКА К НАЗВАНИЮ ЧАТА ==========
console.log('🔥 Исправление: привязка к названию чата...');

// Очищаем старые обработчики и элементы
document.removeEventListener('mousedown', handleMouseDown);
document.removeEventListener('mousemove', handleMouseMove);
document.removeEventListener('mouseup', handleMouseUp);
document.querySelectorAll('#swipe-indicator, #max-tooltip-active, #notes-control-panel, #notes-list-modal, .pinned-note, .inline-editor').forEach(el => el.remove());

// ========== ПЕРЕМЕННЫЕ ==========
let notes = {};
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragTargetChat = null;
let dragIndicator = null;
let currentTooltip = null;
let tooltipTimer = null;
let isPinnedMode = false;
let isListOpen = false;
let pinnedNotes = [];
let animationFrame = null;

// ========== НАСТРОЙКА СИНХРОНИЗАЦИИ (необязательно) ==========
// По умолчанию SYNC_URL пустой — скрипт работает только локально, как раньше,
// заметки видны только на этом компьютере.
//
// Чтобы включить синхронизацию между несколькими компьютерами, разверните
// один из вариантов из папки sync/ этого репозитория (Yandex Cloud Function
// или локальный сервер + туннель) и впишите сюда полученные значения:
const SYNC_URL = '';           // например: 'https://xxxx.trycloudflare.com/'
const SYNC_TOKEN = '';         // тот же секрет, что задан на сервере синхронизации
const SYNC_INTERVAL_MS = 5000; // как часто проверять обновления с сервера
const SYNC_ENABLED = Boolean(SYNC_URL);

// ========== ФУНКЦИИ ХРАНИЛИЩА ==========
function loadNotesLocal() {
  try {
    const data = localStorage.getItem('max_notes_by_name');
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

// запись в localStorage без обратной отправки на сервер (используется, когда
// применяем данные, только что полученные с сервера, чтобы не зациклиться)
function saveNotesLocalRaw(notesObj) {
  localStorage.setItem('max_notes_by_name', JSON.stringify(notesObj));
}

function getLocalUpdatedAt() {
  return parseInt(localStorage.getItem('max_notes_updated_at') || '0', 10);
}

function setLocalUpdatedAt(ts) {
  localStorage.setItem('max_notes_updated_at', String(ts));
}

function saveNotesLocal(notesObj) {
  saveNotesLocalRaw(notesObj);
  const ts = Date.now();
  setLocalUpdatedAt(ts);
  if (SYNC_ENABLED) {
    pushRemoteNotes(notesObj, ts);
  }
}

// ---- сеть (используется только если SYNC_ENABLED) ----
async function pushRemoteNotes(notesObj, ts) {
  try {
    await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'X-Sync-Token': SYNC_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes: notesObj, updatedAt: ts }),
    });
  } catch (e) {
    console.log('⚠️ Не удалось отправить заметки на сервер синхронизации:', e);
  }
}

async function fetchRemoteNotes() {
  try {
    const res = await fetch(SYNC_URL, { headers: { 'X-Sync-Token': SYNC_TOKEN } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.log('⚠️ Не удалось получить заметки с сервера синхронизации:', e);
    return null;
  }
}

function applyRemoteNotes(remoteNotes) {
  notes = remoteNotes || {};
  saveNotesLocalRaw(notes);
  updatePanelCount();
  if (typeof isPinnedMode !== 'undefined' && isPinnedMode) {
    hideAllPinnedNotes();
    showAllPinnedNotes();
  }
  if (typeof isListOpen !== 'undefined' && isListOpen) {
    document.querySelector('#notes-list-modal')?.remove();
    isListOpen = false;
  }
}

async function pollRemoteNotes() {
  const remote = await fetchRemoteNotes();
  if (!remote) return;
  const remoteTs = remote.updatedAt || 0;
  const localTs = getLocalUpdatedAt();
  if (remoteTs > localTs) {
    setLocalUpdatedAt(remoteTs);
    applyRemoteNotes(remote.notes || {});
    console.log('🔄 Заметки обновлены с сервера синхронизации');
  } else if (localTs > remoteTs && Object.keys(notes || {}).length >= 0) {
    // локальная версия новее (например, отправка ранее не удалась) — досылаем
    pushRemoteNotes(notes, localTs);
  }
}

// ⭐ ГЛАВНОЕ ИЗМЕНЕНИЕ: ID чата = полное имя
function getChatId(chatElement) {
  const nameElement = chatElement.querySelector('.name .text');
  if (nameElement) {
    const name = nameElement.textContent.trim();
    // Используем полное имя как ID
    return name;
  }
  
  // fallback: если имя не найдено
  const img = chatElement.querySelector('.avatarImage');
  if (img && img.src) {
    const match = img.src.match(/r=([^&]+)/);
    if (match) return 'user_' + match[1].substring(0, 16);
  }
  
  return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
}

function getChatName(chatElement) {
  const nameEl = chatElement.querySelector('.name .text');
  return nameEl ? nameEl.textContent.trim() : 'Чат без имени';
}

function getChatNameById(chatId) {
  // Сначала пробуем найти чат на странице
  const chats = document.querySelectorAll('.item.svelte-rg2upy');
  for (const el of chats) {
    if (getChatId(el) === chatId) {
      return getChatName(el);
    }
  }
  // Если не найден, возвращаем сам ID (это имя)
  return chatId;
}

function getChatElementByName(chatName) {
  const chats = document.querySelectorAll('.item.svelte-rg2upy');
  for (const el of chats) {
    const name = getChatName(el);
    if (name === chatName) {
      return el;
    }
  }
  return null;
}

// Загружаем заметки
notes = loadNotesLocal();
console.log('📝 Загружено заметок:', Object.keys(notes).length);

if (SYNC_ENABLED) {
  console.log('🔄 Синхронизация включена, адрес сервера:', SYNC_URL);
  pollRemoteNotes();
  setInterval(pollRemoteNotes, SYNC_INTERVAL_MS);
} else {
  console.log('💻 Синхронизация выключена — заметки хранятся только на этом компьютере');
}

// ========== INLINE-РЕДАКТИРОВАНИЕ ==========
function showInlineEditor(chatElement, initialText = '') {
  document.querySelector('.inline-editor')?.remove();
  
  const rect = chatElement.getBoundingClientRect();
  const chatName = getChatName(chatElement);
  const chatId = getChatId(chatElement);
  
  const editor = document.createElement('div');
  editor.className = 'inline-editor';
  editor.dataset.chatId = chatId;
  editor.style.cssText = `
    position: fixed;
    z-index: 100000;
    top: ${Math.max(10, rect.top - 80)}px;
    left: ${Math.max(10, rect.left + 20)}px;
    width: ${Math.min(400, window.innerWidth - 40)}px;
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    border: 2px solid #4a90d9;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: editorIn 0.2s ease-out;
  `;
  
  if (!document.getElementById('editor-styles')) {
    const style = document.createElement('style');
    style.id = 'editor-styles';
    style.textContent = `
      @keyframes editorIn {
        from { opacity: 0; transform: scale(0.95) translateY(-10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes editorOut {
        from { opacity: 1; transform: scale(1) translateY(0); }
        to { opacity: 0; transform: scale(0.95) translateY(-10px); }
      }
    `;
    document.head.appendChild(style);
  }
  
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 12px 16px 8px 16px;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #fafafa;
    border-radius: 16px 16px 0 0;
  `;
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📝</span>
      <span style="font-weight: 600; font-size: 14px; color: #1a1a1a;">${chatName}</span>
    </div>
    <button class="editor-close" style="
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #999;
      padding: 0 4px;
      transition: color 0.15s;
    ">×</button>
  `;
  
  const textarea = document.createElement('textarea');
  textarea.style.cssText = `
    width: 100%;
    min-height: 80px;
    padding: 12px 16px;
    border: none;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.6;
    resize: vertical;
    outline: none;
    background: white;
    color: #1a1a1a;
    box-sizing: border-box;
    border-radius: 0 0 16px 16px;
  `;
  textarea.value = initialText;
  textarea.placeholder = 'Введите заметку...';
  textarea.rows = 3;
  
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 10px 16px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    background: #fafafa;
    border-radius: 0 0 16px 16px;
  `;
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Отмена';
  cancelBtn.style.cssText = `
    padding: 6px 16px;
    border: none;
    border-radius: 8px;
    background: #e8e8e8;
    color: #666;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s;
    font-family: inherit;
  `;
  cancelBtn.addEventListener('mouseenter', () => {
    cancelBtn.style.background = '#d5d5d5';
  });
  cancelBtn.addEventListener('mouseleave', () => {
    cancelBtn.style.background = '#e8e8e8';
  });
  
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 Сохранить';
  saveBtn.style.cssText = `
    padding: 6px 16px;
    border: none;
    border-radius: 8px;
    background: #4a90d9;
    color: white;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s;
    font-family: inherit;
  `;
  saveBtn.addEventListener('mouseenter', () => {
    saveBtn.style.background = '#3a7bc8';
  });
  saveBtn.addEventListener('mouseleave', () => {
    saveBtn.style.background = '#4a90d9';
  });
  
  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
  
  editor.appendChild(header);
  editor.appendChild(textarea);
  editor.appendChild(footer);
  document.body.appendChild(editor);
  
  setTimeout(() => {
    textarea.focus();
    textarea.select();
  }, 50);
  
  function closeEditor(save = false) {
    if (save) {
      const text = textarea.value.trim();
      const chatId = getChatId(chatElement);
      if (text) {
        notes[chatId] = text;
      } else {
        delete notes[chatId];
      }
      saveNotesLocal(notes);
      updatePanelCount();
      console.log(`✅ Заметка ${text ? 'сохранена' : 'удалена'} для "${getChatName(chatElement)}"`);
      showNotification(`✅ Заметка ${text ? 'сохранена' : 'удалена'}`);
      
      if (isPinnedMode) {
        hideAllPinnedNotes();
        showAllPinnedNotes();
      }
    }
    
    editor.style.animation = 'editorOut 0.15s ease-in';
    setTimeout(() => {
      editor.remove();
    }, 150);
  }
  
  header.querySelector('.editor-close').addEventListener('click', () => closeEditor(false));
  cancelBtn.addEventListener('click', () => closeEditor(false));
  saveBtn.addEventListener('click', () => closeEditor(true));
  
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      closeEditor(true);
    }
    if (e.key === 'Escape') {
      closeEditor(false);
    }
  });
  
  const clickOutside = (e) => {
    if (!editor.contains(e.target)) {
      closeEditor(false);
      document.removeEventListener('mousedown', clickOutside);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', clickOutside);
  }, 100);
}

// ========== ПАНЕЛЬ УПРАВЛЕНИЯ ==========
function createControlPanel() {
  const panel = document.createElement('div');
  panel.id = 'notes-control-panel';
  panel.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    z-index: 99996;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: white;
    border-radius: 16px;
    padding: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.12);
    border: 1px solid #e8e8e8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'notes-toggle-mode';
  toggleBtn.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border: none;
    border-radius: 10px;
    background: ${isPinnedMode ? '#e74c3c' : '#4a90d9'};
    color: white;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
    min-width: 160px;
    font-family: inherit;
  `;
  toggleBtn.innerHTML = `
    <span style="font-size: 18px;">${isPinnedMode ? '📌' : '💬'}</span>
    <span>${isPinnedMode ? 'Закрепить' : 'Всплывающие'}</span>
    <span style="margin-left: auto; font-size: 11px; opacity: 0.7;">${isPinnedMode ? 'ON' : 'OFF'}</span>
  `;
  toggleBtn.title = isPinnedMode ? 'Выключить режим "всегда видны"' : 'Включить режим "всегда видны"';
  
  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.transform = 'scale(1.02)';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.transform = 'scale(1)';
  });
  
  toggleBtn.addEventListener('click', () => {
    isPinnedMode = !isPinnedMode;
    toggleBtn.innerHTML = `
      <span style="font-size: 18px;">${isPinnedMode ? '📌' : '💬'}</span>
      <span>${isPinnedMode ? 'Закрепить' : 'Всплывающие'}</span>
      <span style="margin-left: auto; font-size: 11px; opacity: 0.7;">${isPinnedMode ? 'ON' : 'OFF'}</span>
    `;
    toggleBtn.style.background = isPinnedMode ? '#e74c3c' : '#4a90d9';
    toggleBtn.title = isPinnedMode ? 'Выключить режим "всегда видны"' : 'Включить режим "всегда видны"';
    
    if (isPinnedMode) {
      showAllPinnedNotes();
    } else {
      hideAllPinnedNotes();
    }
    console.log(`📌 Режим: ${isPinnedMode ? 'всегда видны' : 'всплывающие'}`);
  });
  
  const listBtn = document.createElement('button');
  listBtn.id = 'notes-list-btn';
  listBtn.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border: none;
    border-radius: 10px;
    background: #2ecc71;
    color: white;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
    min-width: 160px;
    font-family: inherit;
  `;
  listBtn.innerHTML = `
    <span style="font-size: 18px;">📋</span>
    <span>Все заметки</span>
    <span style="margin-left: auto; background: rgba(255,255,255,0.2); padding: 0 8px; border-radius: 10px; font-size: 11px;">${Object.keys(notes).length}</span>
  `;
  listBtn.title = 'Показать все заметки';
  
  listBtn.addEventListener('mouseenter', () => {
    listBtn.style.transform = 'scale(1.02)';
  });
  listBtn.addEventListener('mouseleave', () => {
    listBtn.style.transform = 'scale(1)';
  });
  
  listBtn.addEventListener('click', () => {
    openNotesList();
  });
  
  panel.appendChild(toggleBtn);
  panel.appendChild(listBtn);
  document.body.appendChild(panel);
  
  console.log('✅ Панель управления создана');
  return panel;
}

// ========== РЕЖИМ "ВСЕГДА ВИДНЫ" ==========
function showAllPinnedNotes() {
  hideAllPinnedNotes();
  
  const noteEntries = Object.entries(notes);
  if (noteEntries.length === 0) {
    showNotification('📭 Нет заметок для отображения');
    return;
  }
  
  noteEntries.forEach(([chatName, text]) => {
    // Ищем чат по имени
    const chatElement = getChatElementByName(chatName);
    if (!chatElement) {
      console.log(`⚠️ Чат "${chatName}" не найден на странице`);
      return;
    }
    
    const pin = createPinnedNote(chatElement, chatName, text);
    document.body.appendChild(pin);
    pinnedNotes.push(pin);
  });
  
  updatePinnedPositions();
}

function createPinnedNote(chatElement, chatName, text) {
  const rect = chatElement.getBoundingClientRect();
  
  const pin = document.createElement('div');
  pin.className = 'pinned-note';
  pin.dataset.chatName = chatName;
  pin.style.cssText = `
    position: fixed;
    z-index: 99995;
    top: ${rect.top}px;
    left: ${rect.right + 15}px;
    min-width: 200px;
    max-width: 300px;
    background: white;
    border: 2px solid #e74c3c;
    border-radius: 12px;
    padding: 8px 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #1a1a1a;
    pointer-events: auto;
    cursor: default;
    transition: box-shadow 0.2s;
  `;
  
  const header = document.createElement('div');
  header.style.cssText = `
    font-weight: 600;
    font-size: 11px;
    color: #e74c3c;
    margin-bottom: 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  header.innerHTML = `
    <span>💬 ${chatName}</span>
    <span style="font-size: 10px; color: #999; font-weight: normal;">📌</span>
  `;
  
  const body = document.createElement('div');
  body.style.cssText = `
    word-wrap: break-word;
    white-space: pre-wrap;
    max-height: 100px;
    overflow-y: auto;
    cursor: pointer;
  `;
  body.textContent = text;
  
  body.addEventListener('click', () => {
    showInlineEditor(chatElement, text);
  });
  
  const deleteBtn = document.createElement('div');
  deleteBtn.style.cssText = `
    position: absolute;
    top: -8px;
    right: -8px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #e74c3c;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s;
    font-family: sans-serif;
    line-height: 1;
  `;
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Удалить заметку';
  
  pin.addEventListener('mouseenter', () => {
    deleteBtn.style.opacity = '1';
    pin.style.boxShadow = '0 12px 40px rgba(0,0,0,0.2)';
  });
  pin.addEventListener('mouseleave', () => {
    deleteBtn.style.opacity = '0';
    pin.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
  });
  
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(`Удалить заметку для "${chatName}"?`)) {
      delete notes[chatName];
      saveNotesLocal(notes);
      pin.remove();
      updatePanelCount();
      showNotification(`🗑️ Заметка удалена`);
      if (Object.keys(notes).length === 0) {
        isPinnedMode = false;
        const toggleBtn = document.querySelector('#notes-toggle-mode');
        if (toggleBtn) {
          toggleBtn.innerHTML = `
            <span style="font-size: 18px;">💬</span>
            <span>Всплывающие</span>
            <span style="margin-left: auto; font-size: 11px; opacity: 0.7;">OFF</span>
          `;
          toggleBtn.style.background = '#4a90d9';
        }
      }
    }
  });
  
  pin.appendChild(header);
  pin.appendChild(body);
  pin.appendChild(deleteBtn);
  
  return pin;
}

function hideAllPinnedNotes() {
  pinnedNotes.forEach(pin => pin.remove());
  pinnedNotes = [];
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

function updatePinnedPositions() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
  
  function update() {
    const pinElements = document.querySelectorAll('.pinned-note');
    if (pinElements.length === 0) {
      animationFrame = null;
      return;
    }
    
    pinElements.forEach(pin => {
      const chatName = pin.dataset.chatName;
      const chatElement = getChatElementByName(chatName);
      if (chatElement) {
        const rect = chatElement.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
        if (isVisible) {
          pin.style.display = 'block';
          pin.style.top = Math.max(10, rect.top) + 'px';
          pin.style.left = (rect.right + 15) + 'px';
        } else {
          pin.style.display = 'none';
        }
      }
    });
    
    animationFrame = requestAnimationFrame(update);
  }
  
  animationFrame = requestAnimationFrame(update);
}

// ========== СПИСОК ВСЕХ ЗАМЕТОК ==========
function openNotesList() {
  if (isListOpen) {
    document.querySelector('#notes-list-modal')?.remove();
    isListOpen = false;
    return;
  }
  
  const notes = loadNotesLocal();
  const entries = Object.entries(notes);
  
  if (entries.length === 0) {
    showNotification('📭 Нет заметок');
    return;
  }
  
  const modal = document.createElement('div');
  modal.id = 'notes-list-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 100000;
    width: 500px;
    max-width: 90vw;
    max-height: 80vh;
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    padding: 0;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: modalIn 0.3s ease-out;
  `;
  
  if (!document.getElementById('modal-styles')) {
    const style = document.createElement('style');
    style.id = 'modal-styles';
    style.textContent = `
      @keyframes modalIn {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      @keyframes modalOut {
        from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        to { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
      }
    `;
    document.head.appendChild(style);
  }
  
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 16px 20px;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    background: #fafafa;
    border-radius: 16px 16px 0 0;
  `;
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 20px;">📋</span>
      <span style="font-weight: 600; font-size: 16px;">Все заметки</span>
      <span style="background: #e8e8e8; padding: 0 10px; border-radius: 12px; font-size: 12px; color: #666;">${entries.length}</span>
    </div>
    <button id="modal-close" style="
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #999;
      padding: 0 4px;
      transition: color 0.15s;
    ">×</button>
  `;
  modal.appendChild(header);
  
  const listContainer = document.createElement('div');
  listContainer.style.cssText = `
    padding: 12px 16px;
    overflow-y: auto;
    flex: 1;
    max-height: calc(80vh - 120px);
  `;
  
  // Сортируем по имени чата
  const sortedEntries = entries.sort((a, b) => a[0].localeCompare(b[0]));
  
  sortedEntries.forEach(([chatName, text]) => {
    const date = new Date().toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const item = document.createElement('div');
    item.style.cssText = `
      background: #f8f9fa;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 8px;
      border: 1px solid #eee;
      transition: all 0.15s;
      position: relative;
    `;
    
    item.addEventListener('mouseenter', () => {
      item.style.background = '#f0f2f5';
      item.style.borderColor = '#d0d0d0';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = '#f8f9fa';
      item.style.borderColor = '#eee';
    });
    
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    `;
    headerRow.innerHTML = `
      <span style="font-weight: 600; font-size: 13px; color: #4a90d9; cursor: pointer;">💬 ${chatName}</span>
      <span style="font-size: 11px; color: #999;">${date}</span>
    `;
    
    headerRow.querySelector('span:first-child').addEventListener('click', () => {
      const chatEl = getChatElementByName(chatName);
      if (chatEl) {
        chatEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        closeModal(modal);
      } else {
        showNotification(`⚠️ Чат "${chatName}" не найден`);
      }
    });
    
    const textEl = document.createElement('div');
    textEl.style.cssText = `
      font-size: 14px;
      color: #1a1a1a;
      word-wrap: break-word;
      white-space: pre-wrap;
      line-height: 1.5;
      padding-right: 30px;
      cursor: pointer;
    `;
    textEl.textContent = text;
    
    textEl.addEventListener('click', () => {
      const chatEl = getChatElementByName(chatName);
      if (chatEl) {
        closeModal(modal);
        setTimeout(() => {
          showInlineEditor(chatEl, text);
        }, 300);
      } else {
        showNotification(`⚠️ Чат "${chatName}" не найден`);
      }
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      color: #ccc;
      cursor: pointer;
      font-size: 16px;
      padding: 4px 6px;
      border-radius: 6px;
      transition: all 0.15s;
      font-family: sans-serif;
    `;
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Удалить заметку';
    
    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.style.color = '#e74c3c';
      deleteBtn.style.background = '#fee';
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.style.color = '#ccc';
      deleteBtn.style.background = 'none';
    });
    
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Удалить заметку для "${chatName}"?`)) {
        delete notes[chatName];
        saveNotesLocal(notes);
        item.remove();
        updatePanelCount();
        const countEl = header.querySelector('span:last-child');
        if (countEl) {
          const currentCount = parseInt(countEl.textContent) - 1;
          countEl.textContent = currentCount;
          if (currentCount === 0) {
            listContainer.innerHTML = `
              <div style="text-align: center; color: #bbb; padding: 30px 20px; font-size: 14px;">
                <div style="font-size: 40px; margin-bottom: 10px;">📭</div>
                <div>Нет заметок</div>
              </div>
            `;
          }
        }
        showNotification(`🗑️ Заметка удалена`);
        if (isPinnedMode) {
          hideAllPinnedNotes();
          showAllPinnedNotes();
        }
      }
    });
    
    item.appendChild(headerRow);
    item.appendChild(textEl);
    item.appendChild(deleteBtn);
    listContainer.appendChild(item);
  });
  
  modal.appendChild(listContainer);
  
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 10px 16px;
    border-top: 1px solid #f0f0f0;
    font-size: 11px;
    color: #999;
    text-align: center;
    background: #fafafa;
    border-radius: 0 0 16px 16px;
    flex-shrink: 0;
  `;
  footer.innerHTML = `
    💡 Клик по имени чата — прокрутка • Клик по тексту — редактирование • 🗑️ — удаление
  `;
  modal.appendChild(footer);
  
  document.body.appendChild(modal);
  isListOpen = true;
  
  modal.querySelector('#modal-close').addEventListener('click', () => {
    closeModal(modal);
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal);
    }
  });
  
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      closeModal(modal);
      document.removeEventListener('keydown', escHandler);
    }
  });
}

function closeModal(modal) {
  modal.style.animation = 'modalOut 0.2s ease-in';
  setTimeout(() => {
    modal.remove();
    isListOpen = false;
  }, 200);
}

// ========== УВЕДОМЛЕНИЕ ==========
function showNotification(text) {
  const notif = document.createElement('div');
  notif.style.cssText = `
    position: fixed;
    bottom: 150px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100001;
    background: #2c3e50;
    color: white;
    padding: 12px 24px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.3);
    animation: fadeInUp 0.3s ease-out;
    pointer-events: none;
  `;
  notif.textContent = text;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateX(-50%) translateY(20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes fadeOutDown {
      from { opacity: 1; transform: translateX(-50%) translateY(0); }
      to { opacity: 0; transform: translateX(-50%) translateY(20px); }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.style.animation = 'fadeOutDown 0.3s ease-in';
    setTimeout(() => {
      notif.remove();
      style.remove();
    }, 300);
  }, 2000);
}

// ========== ОБНОВЛЕНИЕ СЧЕТЧИКА ==========
function updatePanelCount() {
  const listBtn = document.querySelector('#notes-list-btn');
  if (listBtn) {
    const notes = loadNotesLocal();
    const count = Object.keys(notes).length;
    const span = listBtn.querySelector('span:last-child');
    if (span) {
      span.textContent = count;
    }
  }
}

// ========== ТУЛТИП (всплывающий режим) ==========
function showTooltip(chatElement, noteText) {
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
    clearTimeout(tooltipTimer);
  }
  
  const rect = chatElement.getBoundingClientRect();
  const chatName = getChatName(chatElement);
  
  const tooltip = document.createElement('div');
  tooltip.id = 'max-tooltip-active';
  tooltip.style.cssText = `
    position: fixed;
    z-index: 99997;
    min-width: 220px;
    max-width: 350px;
    background: white;
    border: 2px solid #4a90d9;
    border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1a1a1a;
    top: ${Math.max(10, rect.top)}px;
    left: ${rect.right + 15}px;
    pointer-events: auto;
    cursor: default;
  `;
  
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 14px 4px 14px;
    font-weight: 600;
    font-size: 12px;
    color: #4a90d9;
    border-bottom: 1px solid #f0f0f0;
    background: #fafafa;
    border-radius: 12px 12px 0 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;
  header.innerHTML = `
    <span>💬 ${chatName}</span>
    <span style="font-size: 10px; color: #999; font-weight: normal;">👆 клик</span>
  `;
  
  const body = document.createElement('div');
  body.style.cssText = `
    padding: 10px 14px 12px 14px;
    word-wrap: break-word;
    white-space: pre-wrap;
    min-height: 20px;
    max-height: 150px;
    overflow-y: auto;
    cursor: pointer;
    transition: background 0.15s;
  `;
  
  if (noteText && noteText.trim()) {
    body.textContent = noteText.trim();
  } else {
    body.textContent = '✏️ Нажмите, чтобы добавить заметку';
    body.style.color = '#999';
    body.style.fontStyle = 'italic';
  }
  
  tooltip.appendChild(header);
  tooltip.appendChild(body);
  document.body.appendChild(tooltip);
  currentTooltip = tooltip;
  
  body.addEventListener('click', function(e) {
    e.stopPropagation();
    clearTimeout(tooltipTimer);
    const chatId = getChatId(chatElement);
    const currentNote = notes[chatId] || '';
    showInlineEditor(chatElement, currentNote);
  });
  
  tooltipTimer = setTimeout(() => {
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
  }, 4000);
}

// ========== ОБРАБОТЧИКИ СВАЙПА ==========
function createSwipeIndicator(chatElement) {
  if (dragIndicator) {
    dragIndicator.remove();
    dragIndicator = null;
  }
  
  const rect = chatElement.getBoundingClientRect();
  
  dragIndicator = document.createElement('div');
  dragIndicator.id = 'swipe-indicator';
  dragIndicator.style.cssText = `
    position: fixed;
    z-index: 99998;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    background: rgba(74, 144, 217, 0.1);
    border: 2px solid #4a90d9;
    border-radius: 8px;
    pointer-events: none;
    transition: all 0.05s linear;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: #4a90d9;
    font-weight: bold;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;
  dragIndicator.innerHTML = `
    <div style="text-align: center;">
      <div style="font-size: 32px;">📝</div>
      <div style="font-size: 12px; margin-top: 4px;">Отпустите для создания заметки</div>
    </div>
  `;
  
  document.body.appendChild(dragIndicator);
  return dragIndicator;
}

function updateSwipeIndicator(chatElement, progress) {
  if (!dragIndicator) return;
  
  const rect = chatElement.getBoundingClientRect();
  const maxOffset = 100;
  const offset = Math.min(progress * maxOffset, maxOffset);
  
  dragIndicator.style.left = (rect.left + offset) + 'px';
  dragIndicator.style.width = (rect.width - offset) + 'px';
  
  if (progress < 0.5) {
    dragIndicator.style.background = `rgba(74, 144, 217, ${0.1 + progress * 0.3})`;
    dragIndicator.style.borderColor = '#4a90d9';
    dragIndicator.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 28px;">👉</div>
        <div style="font-size: 11px; margin-top: 4px;">Тяните вправо</div>
      </div>
    `;
  } else if (progress < 0.8) {
    dragIndicator.style.background = `rgba(46, 204, 113, ${0.2 + progress * 0.3})`;
    dragIndicator.style.borderColor = '#2ecc71';
    dragIndicator.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 32px;">📝</div>
        <div style="font-size: 11px; margin-top: 4px;">Еще немного...</div>
      </div>
    `;
  } else {
    dragIndicator.style.background = `rgba(46, 204, 113, ${0.5 + progress * 0.3})`;
    dragIndicator.style.borderColor = '#27ae60';
    dragIndicator.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 36px;">✅</div>
        <div style="font-size: 11px; margin-top: 4px;">Отпустите!</div>
      </div>
    `;
  }
}

function removeSwipeIndicator() {
  if (dragIndicator) {
    dragIndicator.remove();
    dragIndicator = null;
  }
}

function handleSwipeComplete(chatElement) {
  const chatId = getChatId(chatElement);
  const existingNote = notes[chatId] || '';
  showInlineEditor(chatElement, existingNote);
}

// ========== ОБРАБОТЧИКИ МЫШИ ==========
function handleMouseDown(e) {
  const chatElement = e.target.closest('.item.svelte-rg2upy');
  if (!chatElement) return;
  if (e.button !== 0) return;
  
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragTargetChat = chatElement;
  
  createSwipeIndicator(chatElement);
}

function handleMouseMove(e) {
  if (!isDragging || !dragTargetChat) return;
  
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;
  
  if (Math.abs(deltaY) > 30) {
    removeSwipeIndicator();
    isDragging = false;
    dragTargetChat = null;
    return;
  }
  
  if (deltaX < 0) {
    removeSwipeIndicator();
    isDragging = false;
    dragTargetChat = null;
    return;
  }
  
  const maxSwipe = 150;
  const progress = Math.min(deltaX / maxSwipe, 1);
  updateSwipeIndicator(dragTargetChat, progress);
}

function handleMouseUp(e) {
  if (!isDragging || !dragTargetChat) {
    return;
  }
  
  const deltaX = e.clientX - dragStartX;
  const maxSwipe = 150;
  const progress = Math.min(deltaX / maxSwipe, 1);
  
  removeSwipeIndicator();
  
  if (progress > 0.6) {
    handleSwipeComplete(dragTargetChat);
  } else {
    const chatId = getChatId(dragTargetChat);
    const noteText = notes[chatId] || '';
    if (noteText) {
      showTooltip(dragTargetChat, noteText);
    }
  }
  
  isDragging = false;
  dragTargetChat = null;
}

// ========== МИГРАЦИЯ СТАРЫХ ЗАМЕТОК ==========
function migrateOldNotes() {
  const oldData = localStorage.getItem('max_notes_swipe');
  if (oldData) {
    try {
      const oldNotes = JSON.parse(oldData);
      const newNotes = {};
      let migrated = 0;
      
      // Пробуем сопоставить старые ID с именами
      const chats = document.querySelectorAll('.item.svelte-rg2upy');
      for (const [oldId, text] of Object.entries(oldNotes)) {
        // Ищем чат по старому ID
        let found = false;
        for (const el of chats) {
          const currentId = getChatId(el);
          if (currentId === oldId) {
            newNotes[currentId] = text;
            migrated++;
            found = true;
            break;
          }
        }
        // Если не нашли по ID, пробуем по имени из ID
        if (!found) {
          const name = oldId.replace('chat_', '').replace(/_/g, ' ');
          const chatEl = getChatElementByName(name);
          if (chatEl) {
            const newId = getChatId(chatEl);
            newNotes[newId] = text;
            migrated++;
          }
        }
      }
      
      if (migrated > 0) {
        saveNotesLocal(newNotes);
        console.log(`🔄 Мигрировано ${migrated} заметок из старого формата`);
        notes = newNotes;
        updatePanelCount();
      }
    } catch (e) {
      console.log('⚠️ Ошибка миграции:', e);
    }
  }
}

// ========== ЗАПУСК ==========
// Мигрируем старые заметки
migrateOldNotes();

// Регистрируем обработчики
document.addEventListener('mousedown', handleMouseDown);
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);

// Создаем панель управления
createControlPanel();

console.log('✅ ФИКС ПРИВЯЗКИ К ИМЕНИ ЧАТА!');
console.log('');
console.log('📌 ЧТО ИЗМЕНИЛОСЬ:');
console.log('  ✅ Заметки теперь привязаны к названию чата, а не к индексу');
console.log('  ✅ При перемещении чата в списке заметка остается на месте');
console.log('  ✅ Старые заметки автоматически мигрируются');
console.log('');
console.log('📝 Команды:');
console.log('  showAllNotes() - показать все заметки');
console.log('  clearAllNotes() - удалить все заметки');
console.log('  addNoteByName("Имя чата", "текст") - добавить заметку по имени');

// Полезные команды
function showAllNotes() {
  const notes = loadNotesLocal();
  console.log('📝 Все заметки (привязаны к имени чата):');
  Object.entries(notes).forEach(([name, text]) => {
    console.log(`  "${name}": "${text}"`);
  });
  return notes;
}

function clearAllNotes() {
  if (confirm('Удалить все заметки?')) {
    saveNotesLocal({});
    console.log('🗑️ Все заметки удалены');
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
    hideAllPinnedNotes();
    notes = {};
    updatePanelCount();
    showNotification('🗑️ Все заметки удалены');
  }
}

function addNoteByName(chatName, text) {
  const chatEl = getChatElementByName(chatName);
  if (!chatEl) {
    console.error(`❌ Чат "${chatName}" не найден`);
    return;
  }
  const id = getChatId(chatEl);
  const notes = loadNotesLocal();
  notes[id] = text;
  saveNotesLocal(notes);
  console.log(`✅ Заметка добавлена для "${chatName}": "${text}"`);
  updatePanelCount();
  if (isPinnedMode) {
    hideAllPinnedNotes();
    showAllPinnedNotes();
  }
}

console.log('🎯 Теперь заметки привязаны к ИМЕНИ чата, а не к позиции!');