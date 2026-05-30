// app.js – Lógica completa do Gerenciador de Clientes PWA
// ============================================================

(function () {
  'use strict';

  // ─── Utilidades ───────────────────────────────────────────

  /** Gera UUID v4 */
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /** Retorna data de hoje no formato YYYY-MM-DD */
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  /** Formata data ISO para dd/mm/aaaa */
  function formatDate(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /** Diferença em dias entre data ISO e hoje (positivo = futuro) */
  function diffDays(iso) {
    if (!iso) return Infinity;
    var normalized = parseDateInput(iso);
    if (!normalized) return Infinity;
    var target = new Date(normalized + 'T00:00:00');
    var now = new Date(todayISO() + 'T00:00:00');
    return Math.round((target - now) / 86400000);
  }

  /** Converte datas importadas (YYYY-MM-DD, DD/MM/YYYY ou ISO) para YYYY-MM-DD */
  function parseDateInput(value) {
    if (!value) return '';
    var str = String(value).trim();
    if (!str) return '';

    var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

    var br = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) {
      var dd = br[1].padStart(2, '0');
      var mm = br[2].padStart(2, '0');
      return br[3] + '-' + mm + '-' + dd;
    }

    var parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
      var y = parsed.getFullYear();
      var m = String(parsed.getMonth() + 1).padStart(2, '0');
      var d = String(parsed.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    return '';
  }

  /** Normaliza texto para buscas sem acento e sem diferença entre maiúsculas/minúsculas */
  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  /** Prepara telefone para wa.me. Se vier DDD sem país, adiciona 55. */
  function normalizeWhatsAppNumber(phone) {
    var digits = onlyDigits(phone);
    digits = digits.replace(/^00+/, '');
    if (digits.length === 10 || digits.length === 11) return '55' + digits;
    if (digits.indexOf('55') === 0 && digits.length >= 12) return digits;
    return digits;
  }

  function isValidWhatsAppNumber(phone) {
    var digits = normalizeWhatsAppNumber(phone);
    return digits.length >= 12 && digits.length <= 15;
  }

  /** Deep clone via JSON */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Formata telefone para exibição */
  function formatPhone(phone) {
    var digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 11) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
    if (digits.length === 10) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6);
    return phone || '';
  }

  // ─── LocalStorage (camada de persistência) ────────────────

  var KEYS = {
    clients: 'pwa_clientes',
    config: 'pwa_config',
    undoStack: 'pwa_undo',
    redoStack: 'pwa_redo'
  };

  // ─── Google Sheets (Apps Script da versão antiga) ───────────
  // Mantém o visual moderno, mas usa o mesmo backend da página antiga:
  // GET  ?action=get_all_clients
  // POST ?action=bulk_update_clients { clients: [...] }
  var WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyHKKeGamiImtqK0G-DJpJI3E_y83ZlVQq6A3kjW0LmRE9iRvNuG3VCOQmpt_s2XwLIrg/exec';
  var sheetsLoadInProgress = false;
  var sheetsSaveInProgress = false;
  var sheetsSavePending = false;
  var sheetsSaveTimer = null;
  var sheetsLastSavedSignature = '';

  function canUseGoogleSheets() {
    return !!WEB_APP_URL && WEB_APP_URL.indexOf('script.google.com/macros/s/') !== -1;
  }

  function setSheetsStatus(message, type) {
    var el = document.getElementById('sheetsStatus');
    if (!el) return;
    el.textContent = message || 'Sheets: aguardando';
    el.className = 'last-update sheets-status' + (type ? ' ' + type : '');
  }

  async function sendRequestToBackend(action, data) {
    if (!canUseGoogleSheets()) throw new Error('WEB_APP_URL não configurado.');
    var url = WEB_APP_URL + '?action=' + encodeURIComponent(action);
    var options = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data || {})
    };

    if (action === 'get_all_clients') {
      options.method = 'GET';
      delete options.body;
    }

    var response = await fetch(url, options);
    if (!response.ok) {
      var errorText = await response.text();
      throw new Error('Erro de rede ou servidor: ' + response.status + ' - ' + errorText);
    }

    var result = await response.json();
    if (result && result.status === 'error') {
      throw new Error(result.message || 'Erro desconhecido do backend.');
    }
    return result;
  }

  function boolFromSheet(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    var str = normalizeText(value);
    return ['true', '1', 'sim', 'yes', 'y', 'x', 'ok'].indexOf(str) !== -1;
  }

  function dateToSheet(value) {
    var iso = parseDateInput(value);
    if (!iso) return '';
    return formatDate(iso);
  }

  function productFromName(name) {
    var match = String(name || '').match(/\(([^)]+)\)\s*$/);
    return match ? match[1].trim() : '';
  }

  function sheetLogToHistory(log) {
    if (!log) return null;
    if (typeof log === 'string') {
      return { data: new Date().toISOString(), acao: log };
    }
    return {
      data: log.data || log.date || log.criadoEm || log.t || new Date().toISOString(),
      acao: String(log.acao || log.action || log.mensagem || log.message || log.a || JSON.stringify(log))
    };
  }

  function historyToSheetLogs(history) {
    if (!Array.isArray(history)) return [];
    return history.slice(-50).map(function (item) {
      return {
        t: item.data || new Date().toISOString(),
        a: item.acao || item.action || '',
        e: item.e || item.extra || ''
      };
    });
  }

  function normalizeSheetsClient(item, usedIds) {
    if (!item || (!item.nome && !item.telefone)) return null;

    var telefone = onlyDigits(item.telefone);
    var rawId = item.id !== undefined && item.id !== null && String(item.id).trim() !== ''
      ? String(item.id).trim()
      : (telefone.length >= 5 ? telefone.slice(-5) : uuid());

    var id = rawId;
    while (usedIds[id]) id = uuid();
    usedIds[id] = true;

    var historico = [];
    if (Array.isArray(item.historico)) {
      historico = item.historico.slice();
    } else if (Array.isArray(item.logs)) {
      historico = item.logs.map(sheetLogToHistory).filter(Boolean);
    }

    return {
      id: id,
      nome: String(item.nome || '').trim(),
      telefone: telefone,
      produto: String(item.produto || item.Produto || item.produtoServico || item.servico || productFromName(item.nome) || '').trim(),
      vencimento: parseDateInput(item.vencimento || item.data || item.Data),
      observacoes: String(item.observacoes || item.observacao || item.obs || '').trim(),
      cobranca: parseDateInput(item.cobranca || item.dataCobranca || item.DataCobranca),
      avisado: boolFromSheet(item.avisado),
      debito: boolFromSheet(item.debito),
      arquivado: boolFromSheet(item.arquivado),
      oculto: boolFromSheet(item.oculto),
      desativado: boolFromSheet(item.desativado),
      dola_sent: boolFromSheet(item.dola_sent),
      clicado: boolFromSheet(item.clicado),
      verDepois: parseDateInput(item.verDepois || item.reexibirEm),
      historico: historico,
      criadoEm: item.criadoEm || new Date().toISOString()
    };
  }

  function normalizeSheetsResponse(response) {
    var raw = Array.isArray(response) ? response :
      (response && Array.isArray(response.clients)) ? response.clients :
      (response && Array.isArray(response.data)) ? response.data : [];

    var usedIds = {};
    return raw.map(function (item) {
      return normalizeSheetsClient(item, usedIds);
    }).filter(Boolean);
  }

  function clientToSheets(client) {
    return {
      id: client.id,
      data: dateToSheet(client.vencimento),
      nome: client.nome || '',
      telefone: onlyDigits(client.telefone),
      avisado: !!client.avisado,
      debito: !!client.debito,
      Produto: client.produto || '',
      arquivado: !!client.arquivado,
      oculto: !!client.oculto,
      reexibirEm: dateToSheet(client.verDepois) || null,
      desativado: !!client.desativado,
      dola_sent: !!client.dola_sent,
      clicado: !!client.clicado,
      dataCobranca: dateToSheet(client.cobranca) || null,
      observacao: client.observacoes || '',
      logs: historyToSheetLogs(client.historico)
    };
  }

  function sheetsSignature(list) {
    try {
      return JSON.stringify((list || []).map(clientToSheets));
    } catch (e) {
      return String(Date.now());
    }
  }

  async function loadClientsFromGoogleSheets(options) {
    options = options || {};
    if (!canUseGoogleSheets()) return loadClients();

    sheetsLoadInProgress = true;
    setSheetsStatus('Sheets: puxando...', 'syncing');
    showLoading(true);

    try {
      var response = await sendRequestToBackend('get_all_clients');
      var clientsFromSheets = normalizeSheetsResponse(response);

      localStorage.setItem(KEYS.clients, JSON.stringify(clientsFromSheets));
      sheetsLastSavedSignature = sheetsSignature(clientsFromSheets);
      selectedIds.clear();
      updateLastModified();
      renderAll();

      setSheetsStatus('Sheets: sincronizado', 'ok');
      if (!options.silent) {
        showToast('Dados puxados do Google Sheets: ' + clientsFromSheets.length + ' cliente(s).', 'success');
      }
      return clientsFromSheets;
    } catch (error) {
      console.error('Erro ao puxar do Google Sheets:', error);
      setSheetsStatus('Sheets: erro ao puxar', 'error');
      if (!options.silent) {
        showToast('Erro ao puxar do Google Sheets: ' + error.message, 'error');
      } else {
        showToast('Não consegui puxar do Google Sheets. Usando dados locais.', 'warning');
      }
      renderAll();
      return loadClients();
    } finally {
      sheetsLoadInProgress = false;
      showLoading(false);
    }
  }

  function queueGoogleSheetsSave(list) {
    if (!canUseGoogleSheets() || sheetsLoadInProgress) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSheetsStatus('Sheets: offline', 'warning');
      return;
    }

    clearTimeout(sheetsSaveTimer);
    sheetsSaveTimer = setTimeout(function () {
      syncClientsToGoogleSheets(list || loadClients());
    }, 650);
  }

  async function syncClientsToGoogleSheets(list, options) {
    options = options || {};
    if (!canUseGoogleSheets() || sheetsLoadInProgress) return;

    if (sheetsSaveInProgress) {
      sheetsSavePending = true;
      return;
    }

    var clientsToSave = list || loadClients();
    var signature = sheetsSignature(clientsToSave);
    if (!options.force && signature === sheetsLastSavedSignature) return;

    sheetsSaveInProgress = true;
    setSheetsStatus('Sheets: salvando...', 'syncing');

    try {
      var response = await sendRequestToBackend('bulk_update_clients', {
        clients: clientsToSave.map(clientToSheets)
      });

      if (response && response.status && response.status !== 'success') {
        throw new Error(response.message || 'Erro ao sincronizar com backend.');
      }

      sheetsLastSavedSignature = signature;
      setSheetsStatus('Sheets: salvo', 'ok');
      if (options.showToast) showToast('Dados enviados para o Google Sheets.', 'success');
    } catch (error) {
      console.error('Erro ao salvar no Google Sheets:', error);
      setSheetsStatus('Sheets: erro ao salvar', 'error');
      showToast('Salvo localmente, mas falhou no Google Sheets: ' + error.message, 'warning');
    } finally {
      sheetsSaveInProgress = false;
      if (sheetsSavePending) {
        sheetsSavePending = false;
        queueGoogleSheetsSave(loadClients());
      }
    }
  }

  function ensureGoogleSheetsControls() {
    setSheetsStatus('Sheets: aguardando', '');
  }

  function loadClients() {
    try { return JSON.parse(localStorage.getItem(KEYS.clients)) || []; }
    catch (e) { return []; }
  }

  function saveClients(list, options) {
    options = options || {};
    localStorage.setItem(KEYS.clients, JSON.stringify(list));
    updateLastModified();
    if (!options.skipGoogleSheets) {
      queueGoogleSheetsSave(list);
    }
  }

  function defaultColumnVisibility() {
    return {
      select: true,
      nome: true,
      telefone: true,
      produto: true,
      vencimento: true,
      cobranca: true,
      verDepois: true,
      status: true,
      acoes: true
    };
  }

  function defaultActionVisibility() {
    return {
      edit: true,
      delete: true,
      whatsapp: true,
      'copy-message': true,
      renew: true,
      notify: true,
      debit: true,
      schedule: true,
      product: true,
      history: true
    };
  }

  function defaultConfig() {
    return {
      primaryColor: '#0d9488',
      accentColor: '#7c3aed',
      darkMode: false,
      lastModified: null,
      visibleColumns: defaultColumnVisibility(),
      visibleActions: defaultActionVisibility()
    };
  }

  function mergeConfig(stored) {
    var defaults = defaultConfig();
    stored = stored || {};
    return Object.assign({}, defaults, stored, {
      visibleColumns: Object.assign({}, defaults.visibleColumns, stored.visibleColumns || {}),
      visibleActions: Object.assign({}, defaults.visibleActions, stored.visibleActions || {})
    });
  }

  function loadConfig() {
    try { return mergeConfig(JSON.parse(localStorage.getItem(KEYS.config)) || {}); }
    catch (e) { return defaultConfig(); }
  }

  function saveConfig(cfg) {
    localStorage.setItem(KEYS.config, JSON.stringify(mergeConfig(cfg)));
  }

  function updateLastModified() {
    var cfg = loadConfig();
    cfg.lastModified = new Date().toLocaleString('pt-BR');
    saveConfig(cfg);
    refreshLastModified();
  }

  function refreshLastModified() {
    var cfg = loadConfig();
    var el = document.getElementById('lastUpdate');
    if (!el) return;
    el.textContent = cfg.lastModified ? 'Atualizado: ' + cfg.lastModified : '';
  }

  // ─── Undo / Redo (pilha de até 10 estados) ───────────────

  var MAX_UNDO = 10;

  function loadStack(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch (e) { return []; }
  }

  function saveStack(key, stack) {
    localStorage.setItem(key, JSON.stringify(stack));
  }

  /** Salva estado atual antes de uma mudança */
  function pushUndo() {
    var stack = loadStack(KEYS.undoStack);
    stack.push(clone(loadClients()));
    if (stack.length > MAX_UNDO) stack.shift();
    saveStack(KEYS.undoStack, stack);
    // Limpar redo ao fazer nova ação
    saveStack(KEYS.redoStack, []);
    updateUndoRedoButtons();
  }

  function undo() {
    var undoStack = loadStack(KEYS.undoStack);
    if (undoStack.length === 0) return;
    var redoStack = loadStack(KEYS.redoStack);
    // Salvar estado atual no redo
    redoStack.push(clone(loadClients()));
    saveStack(KEYS.redoStack, redoStack);
    // Restaurar estado anterior
    var prev = undoStack.pop();
    saveStack(KEYS.undoStack, undoStack);
    saveClients(prev);
    renderAll();
    showToast('Ação desfeita', 'info');
  }

  function redo() {
    var redoStack = loadStack(KEYS.redoStack);
    if (redoStack.length === 0) return;
    var undoStack = loadStack(KEYS.undoStack);
    undoStack.push(clone(loadClients()));
    saveStack(KEYS.undoStack, undoStack);
    var next = redoStack.pop();
    saveStack(KEYS.redoStack, redoStack);
    saveClients(next);
    renderAll();
    showToast('Ação refeita', 'info');
  }

  function updateUndoRedoButtons() {
    var u = loadStack(KEYS.undoStack);
    var r = loadStack(KEYS.redoStack);
    var undoBtn = document.getElementById('undoBtn');
    var redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = u.length === 0;
    if (redoBtn) redoBtn.disabled = r.length === 0;
  }

  // ─── Cálculo de Status ────────────────────────────────────

  function getStatus(client) {
    if (client.desativado) return 'desativado';
    if (client.arquivado) return 'arquivado';
    if (client.debito) return 'debito';
    if (client.avisado) return 'avisado';
    var d = diffDays(client.vencimento);
    if (d < 0) return 'vencido';
    if (d === 0) return 'vencendo-hoje';
    if (d <= 3) return 'proximo-vencimento';
    return 'ativo';
  }

  function statusLabel(s) {
    var map = {
      'ativo': 'Ativo',
      'vencendo-hoje': 'Vencendo Hoje',
      'proximo-vencimento': 'Próx. Vencimento',
      'vencido': 'Vencido',
      'avisado': 'Avisado',
      'debito': 'Em Débito',
      'arquivado': 'Arquivado',
      'desativado': 'Desativado'
    };
    return map[s] || s;
  }

  function statusBadgeClass(s) {
    var map = {
      'ativo': 'badge-ativo',
      'vencendo-hoje': 'badge-vencendo-hoje',
      'proximo-vencimento': 'badge-proximo',
      'vencido': 'badge-vencido',
      'avisado': 'badge-avisado',
      'debito': 'badge-debito',
      'arquivado': 'badge-arquivado',
      'desativado': 'badge-desativado'
    };
    return map[s] || '';
  }

  function statusRowClass(s) {
    if (s === 'vencido') return 'row-vencido';
    if (s === 'vencendo-hoje' || s === 'proximo-vencimento') return 'row-vencendo';
    return '';
  }

  // ─── Contadores de status ─────────────────────────────────

  function countStatuses(clients) {
    var counts = {
      all: 0, ativo: 0, 'vencendo-hoje': 0, 'hoje-vencidos': 0, 'proximo-vencimento': 0,
      vencido: 0, 'cobranca-hoje': 0, 'ver-depois': 0, avisado: 0, debito: 0,
      arquivado: 0, desativado: 0
    };
    var today = todayISO();
    clients.forEach(function (c) {
      counts.all++;
      var s = getStatus(c);
      if (counts[s] !== undefined) counts[s]++;
      if (s === 'vencendo-hoje' || s === 'vencido') counts['hoje-vencidos']++;
      if (c.cobranca === today && !c.arquivado && !c.desativado) counts['cobranca-hoje']++;
      if (c.verDepois && c.verDepois <= today && !c.arquivado && !c.desativado) counts['ver-depois']++;
    });
    return counts;
  }

  // ─── Filtro e Busca ───────────────────────────────────────

  var currentFilter = 'vencido';
  var currentSearch = '';
  var currentProdutoFilter = '';
  var currentVencimentoFilter = '';

  function applyFilters(clients) {
    var today = todayISO();
    return clients.filter(function (c) {
      // Filtro de status
      if (currentFilter !== 'all') {
        var s = getStatus(c);
        if (currentFilter === 'cobranca-hoje') {
          if (c.cobranca !== today || c.arquivado || c.desativado) return false;
        } else if (currentFilter === 'hoje-vencidos') {
          if (s !== 'vencendo-hoje' && s !== 'vencido') return false;
        } else if (currentFilter === 'ver-depois') {
          if (!c.verDepois || c.verDepois > today || c.arquivado || c.desativado) return false;
        } else if (currentFilter === 'proximo-vencimento') {
          if (s !== 'proximo-vencimento') return false;
        } else if (s !== currentFilter) {
          return false;
        }
      }
      // Filtro de produto
      if (currentProdutoFilter && c.produto !== currentProdutoFilter) return false;
      // Filtro de vencimento
      if (currentVencimentoFilter) {
        var d = diffDays(c.vencimento);
        if (currentVencimentoFilter === 'hoje' && d !== 0) return false;
        if (currentVencimentoFilter === 'semana' && (d < 0 || d > 7)) return false;
        if (currentVencimentoFilter === 'mes' && (d < 0 || d > 30)) return false;
      }
      // Busca por nome, telefone, produto, vencimento ou observação
      if (currentSearch) {
        var q = normalizeText(currentSearch);
        var qDigits = onlyDigits(currentSearch);
        var textHaystack = normalizeText([
          c.nome,
          c.produto,
          c.observacoes,
          c.observacao,
          c.vencimento,
          formatDate(c.vencimento),
          c.cobranca,
          formatDate(c.cobranca),
          c.verDepois,
          formatDate(c.verDepois)
        ].join(' '));
        var phoneHaystack = onlyDigits(c.telefone);
        var textMatch = !!q && textHaystack.indexOf(q) !== -1;
        var phoneMatch = !!qDigits && phoneHaystack.indexOf(qDigits) !== -1;
        if (!textMatch && !phoneMatch) return false;
      }
      return true;
    });
  }

  // ─── Seleção múltipla ─────────────────────────────────────

  var selectedIds = new Set();

  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    updateBatchBar();
    updateSelectAllCheckbox();
  }

  function selectAll(checked) {
    var filtered = applyFilters(loadClients());
    selectedIds.clear();
    if (checked) filtered.forEach(function (c) { selectedIds.add(c.id); });
    renderTable();
    updateBatchBar();
  }

  function updateBatchBar() {
    var bar = document.getElementById('batchBar');
    var count = document.getElementById('selectedCount');
    if (selectedIds.size > 0) {
      bar.hidden = false;
      count.textContent = selectedIds.size + ' selecionado(s)';
    } else {
      bar.hidden = true;
    }
  }

  function updateSelectAllCheckbox() {
    var cb = document.getElementById('selectAll');
    var filtered = applyFilters(loadClients());
    if (filtered.length === 0) { cb.checked = false; cb.indeterminate = false; return; }
    var allSelected = filtered.every(function (c) { return selectedIds.has(c.id); });
    var someSelected = filtered.some(function (c) { return selectedIds.has(c.id); });
    cb.checked = allSelected;
    cb.indeterminate = !allSelected && someSelected;
  }

  // ─── Renderização ─────────────────────────────────────────

  function renderAll() {
    renderSidebarCounts();
    renderStatusBadges();
    renderTable();
    renderProdutoFilter();
    applyVisibilitySettings();
    updateBatchBar();
    updateUndoRedoButtons();
    refreshLastModified();
  }

  function renderSidebarCounts() {
    var clients = loadClients();
    var counts = countStatuses(clients);
    setText('countAll', counts.all);
    setText('countAtivo', counts.ativo);
    setText('countVencendoHoje', counts['vencendo-hoje']);
    setText('countHojeVencidos', counts['hoje-vencidos']);
    setText('countProximoVenc', counts['proximo-vencimento']);
    setText('countVencido', counts.vencido);
    setText('countCobrancaHoje', counts['cobranca-hoje']);
    setText('countVerDepois', counts['ver-depois']);
    setText('countAvisado', counts.avisado);
    setText('countDebito', counts.debito);
    setText('countArquivado', counts.arquivado);
    setText('countDesativado', counts.desativado);
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function renderStatusBadges() {
    var clients = loadClients();
    var counts = countStatuses(clients);
    var container = document.getElementById('statusBadges');
    if (!container) return;
    var badges = [
      { key: 'ativo', icon: '✅', label: 'Ativos', cls: 'badge-ativo' },
      { key: 'vencendo-hoje', icon: '⏰', label: 'Vencendo Hoje', cls: 'badge-vencendo-hoje' },
      { key: 'hoje-vencidos', icon: '🔥', label: 'Hoje + Vencidos', cls: 'badge-vencido' },
      { key: 'proximo-vencimento', icon: '⚠️', label: 'Próx. Venc.', cls: 'badge-proximo' },
      { key: 'vencido', icon: '❌', label: 'Vencidos', cls: 'badge-vencido' },
      { key: 'avisado', icon: '📢', label: 'Avisados', cls: 'badge-avisado' },
      { key: 'debito', icon: '💳', label: 'Em Débito', cls: 'badge-debito' },
      { key: 'cobranca-hoje', icon: '💰', label: 'Cobrança Hoje', cls: 'badge-vencendo-hoje' },
      { key: 'ver-depois', icon: '⏳', label: 'Ver Depois', cls: 'badge-proximo' }
    ];
    container.innerHTML = badges.map(function (b) {
      return '<div class="status-card ' + b.cls + (b.key === currentFilter ? ' active' : '') + '" data-filter="' + b.key + '" title="Filtrar por ' + b.label + '">' +
        '<span class="card-icon status-card-icon">' + b.icon + '</span>' +
        '<span class="card-count status-card-count">' + (counts[b.key] || 0) + '</span>' +
        '<span class="card-label status-card-label">' + b.label + '</span>' +
        '</div>';
    }).join('');
    // Click em status card aplica filtro
    container.querySelectorAll('.status-card').forEach(function (card) {
      card.addEventListener('click', function () {
        setFilter(card.dataset.filter);
        if (isMobileFilterLayout()) {
          setMobileFiltersCollapsed(true);
        }
      });
    });
  }

  function isMobileFilterLayout() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  }

  function setMobileFiltersCollapsed(collapsed) {
    var badges = document.getElementById('statusBadges');
    var btn = document.getElementById('toggleMobileFilters');
    if (!badges || !btn) return;

    badges.classList.toggle('mobile-collapsed', !!collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.textContent = collapsed ? '🔎 Mostrar filtros rápidos' : '🔼 Recolher filtros rápidos';
  }

  function toggleMobileFilters() {
    var badges = document.getElementById('statusBadges');
    if (!badges) return;
    setMobileFiltersCollapsed(!badges.classList.contains('mobile-collapsed'));
  }

  function compareClientsByOldestDueDate(a, b) {
    var da = parseDateInput(a && a.vencimento);
    var db = parseDateInput(b && b.vencimento);

    if (da && db && da !== db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;

    var na = normalizeText(a && a.nome);
    var nb = normalizeText(b && b.nome);
    return na.localeCompare(nb);
  }

  function renderTable() {
    var clients = loadClients();
    var filtered = applyFilters(clients);
    var tbody = document.getElementById('clientTableBody');
    var empty = document.getElementById('emptyState');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    // Ordenar sempre da data de vencimento mais velha para a mais nova.
    filtered.sort(compareClientsByOldestDueDate);

    tbody.innerHTML = filtered.map(function (c) {
      var s = getStatus(c);
      var checked = selectedIds.has(c.id) ? 'checked' : '';
      var rowCls = statusRowClass(s);
      var selCls = selectedIds.has(c.id) ? ' selected' : '';
      return '<tr class="' + rowCls + selCls + '" data-id="' + c.id + '">' +
        '<td class="col-check"><input type="checkbox" class="row-check" data-id="' + c.id + '" ' + checked + ' /></td>' +
        '<td class="col-name"><button class="name-action" data-id="' + c.id + '" title="Enviar cobrança pelo WhatsApp">' + escapeHtml(c.nome) + '</button></td>' +
        '<td class="col-phone"><button class="phone-action" data-id="' + c.id + '" title="Enviar cobrança pelo WhatsApp">' + escapeHtml(formatPhone(c.telefone)) + '</button></td>' +
        '<td class="col-product">' + escapeHtml(c.produto) + '</td>' +
        '<td class="col-due">' + formatDate(c.vencimento) + '</td>' +
        '<td class="col-billing">' + formatDate(c.cobranca) + '</td>' +
        '<td class="col-review">' + formatDate(c.verDepois) + '</td>' +
        '<td class="col-status"><span class="badge ' + statusBadgeClass(s) + '">' + statusLabel(s) + '</span></td>' +
        '<td class="col-actions">' +
          '<button class="action-btn edit" data-id="' + c.id + '" title="Editar">✏️</button>' +
          '<button class="action-btn delete" data-id="' + c.id + '" title="Excluir">🗑️</button>' +
          '<button class="action-btn whatsapp" data-id="' + c.id + '" title="Enviar cobrança pelo WhatsApp">💬</button>' +
          '<button class="action-btn copy-message" data-id="' + c.id + '" title="Copiar mensagem de cobrança">📋</button>' +
          '<button class="action-btn renew" data-id="' + c.id + '" title="Renovar">🔄</button>' +
          '<button class="action-btn notify" data-id="' + c.id + '" title="' + (c.avisado ? 'Desmarcar Avisado' : 'Marcar Avisado') + '">' + (c.avisado ? '🔕' : '📢') + '</button>' +
          '<button class="action-btn debit" data-id="' + c.id + '" title="' + (c.debito ? 'Remover Débito' : 'Marcar Débito') + '">' + (c.debito ? '💚' : '💳') + '</button>' +
          '<button class="action-btn schedule" data-id="' + c.id + '" title="Ver Depois">⏳</button>' +
          '<button class="action-btn product" data-id="' + c.id + '" title="Alterar Produto">🏷️</button>' +
          '<button class="action-btn history" data-id="' + c.id + '" title="Histórico">📜</button>' +
        '</td>' +
        '</tr>';
    }).join('');

    applyVisibilitySettings();

    // Bind eventos de checkbox
    tbody.querySelectorAll('.row-check').forEach(function (cb) {
      cb.addEventListener('change', function () { toggleSelect(cb.dataset.id); renderTable(); });
    });

    // Bind clique no nome/telefone para abrir cobrança no WhatsApp
    tbody.querySelectorAll('.phone-action, .name-action').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        sendClientMessage(btn.dataset.id);
      });
    });

    // Bind ações individuais
    tbody.querySelectorAll('.action-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.dataset.id;
        if (btn.classList.contains('edit')) editClient(id);
        else if (btn.classList.contains('delete')) confirmDelete([id]);
        else if (btn.classList.contains('whatsapp')) sendClientMessage(id);
        else if (btn.classList.contains('copy-message')) copyClientMessage(id);
        else if (btn.classList.contains('renew')) openRenewModal(id);
        else if (btn.classList.contains('notify')) toggleAvisado(id);
        else if (btn.classList.contains('debit')) toggleDebito(id);
        else if (btn.classList.contains('schedule')) openVerDepois(id);
        else if (btn.classList.contains('product')) openChangeProduto(id);
        else if (btn.classList.contains('history')) openHistory(id);
      });
    });

    updateSelectAllCheckbox();
  }

  function renderProdutoFilter() {
    var clients = loadClients();
    var produtos = {};
    clients.forEach(function (c) { if (c.produto) produtos[c.produto] = true; });
    var sel = document.getElementById('filterProduto');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">Todos os Produtos</option>';
    Object.keys(produtos).sort().forEach(function (p) {
      sel.innerHTML += '<option value="' + escapeHtml(p) + '"' + (p === current ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
    });
    // Atualizar datalist do formulário
    var dl = document.getElementById('produtosList');
    if (dl) {
      dl.innerHTML = Object.keys(produtos).sort().map(function (p) {
        return '<option value="' + escapeHtml(p) + '">';
      }).join('');
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function applyVisibilitySettings() {
    var cfg = loadConfig();
    var columns = Object.assign(defaultColumnVisibility(), cfg.visibleColumns || {});
    var actions = Object.assign(defaultActionVisibility(), cfg.visibleActions || {});
    var body = document.body;
    if (!body) return;

    Object.keys(defaultColumnVisibility()).forEach(function (key) {
      body.classList.toggle('hide-col-' + key, columns[key] === false);
    });

    Object.keys(defaultActionVisibility()).forEach(function (key) {
      body.classList.toggle('hide-action-' + key, actions[key] === false);
    });
  }

  function loadSettingsForm() {
    var cfg = loadConfig();

    document.querySelectorAll('[data-column-toggle]').forEach(function (input) {
      var key = input.dataset.columnToggle;
      input.checked = cfg.visibleColumns[key] !== false;
    });

    document.querySelectorAll('[data-action-toggle]').forEach(function (input) {
      var key = input.dataset.actionToggle;
      input.checked = cfg.visibleActions[key] !== false;
    });
  }

  // ─── Filtros ──────────────────────────────────────────────

  function setFilter(f) {
    currentFilter = f;
    // Atualizar sidebar active
    document.querySelectorAll('.sidebar-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.filter === f);
    });
    document.querySelectorAll('.status-card').forEach(function (card) {
      card.classList.toggle('active', card.dataset.filter === f);
    });
    selectedIds.clear();
    renderTable();
    renderStatusBadges();
    updateBatchBar();
  }

  function isDesktopViewForced() {
    return localStorage.getItem('pwa_force_desktop_view') === 'true';
  }

  function applyDesktopViewPreference() {
    var forced = isDesktopViewForced();
    if (document.body) {
      document.body.classList.toggle('force-desktop-view', forced);
    }

    var btn = document.getElementById('desktopViewBtn');
    if (btn) {
      btn.textContent = forced ? '📱 Visualizar como celular' : '🖥️ Visualizar como PC';
      btn.setAttribute('aria-pressed', String(forced));
      btn.title = forced ? 'Voltar para visualização mobile' : 'Mostrar a página como no computador';
    }
  }

  function toggleDesktopView() {
    var next = !isDesktopViewForced();
    localStorage.setItem('pwa_force_desktop_view', String(next));
    applyDesktopViewPreference();

    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
      if (next) {
        sidebar.classList.remove('collapsed');
      } else if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
        sidebar.classList.add('collapsed');
      }
    }

    renderTable();
    showToast(next ? 'Visualização de PC ativada.' : 'Visualização mobile ativada.', 'info');
  }

  function closeSidebarOnMobile() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar || isDesktopViewForced()) return;
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      sidebar.classList.add('collapsed');
    }
  }

  // ─── CRUD de Clientes ─────────────────────────────────────

  function addClient(data) {
    pushUndo();
    var clients = loadClients();
    var c = {
      id: uuid(),
      nome: data.nome.trim(),
      telefone: data.telefone.replace(/\D/g, ''),
      produto: data.produto.trim(),
      vencimento: data.vencimento,
      observacoes: data.observacoes || '',
      cobranca: data.cobranca || '',
      avisado: false,
      debito: false,
      arquivado: false,
      desativado: false,
      verDepois: '',
      historico: [{ data: new Date().toISOString(), acao: 'Cliente cadastrado' }],
      criadoEm: new Date().toISOString()
    };
    clients.push(c);
    saveClients(clients);
    renderAll();
    showToast('Cliente adicionado com sucesso!', 'success');
  }

  function updateClient(id, data) {
    pushUndo();
    var clients = loadClients();
    var idx = clients.findIndex(function (c) { return c.id === id; });
    if (idx === -1) return;
    var old = clients[idx];
    clients[idx] = Object.assign({}, old, {
      nome: data.nome.trim(),
      telefone: data.telefone.replace(/\D/g, ''),
      produto: data.produto.trim(),
      vencimento: data.vencimento,
      observacoes: data.observacoes || '',
      cobranca: data.cobranca || ''
    });
    clients[idx].historico = clients[idx].historico || [];
    clients[idx].historico.push({ data: new Date().toISOString(), acao: 'Dados atualizados' });
    saveClients(clients);
    renderAll();
    showToast('Cliente atualizado!', 'success');
  }

  function deleteClients(ids) {
    pushUndo();
    var clients = loadClients();
    clients = clients.filter(function (c) { return ids.indexOf(c.id) === -1; });
    saveClients(clients);
    ids.forEach(function (id) { selectedIds.delete(id); });
    renderAll();
    showToast(ids.length + ' cliente(s) excluído(s)', 'info');
  }

  function editClient(id) {
    var clients = loadClients();
    var c = clients.find(function (cl) { return cl.id === id; });
    if (!c) return;
    document.getElementById('clientModalTitle').textContent = 'Editar Cliente';
    document.getElementById('clientId').value = c.id;
    document.getElementById('clientNome').value = c.nome;
    document.getElementById('clientTelefone').value = c.telefone;
    document.getElementById('clientProduto').value = c.produto;
    document.getElementById('clientVencimento').value = c.vencimento;
    document.getElementById('clientCobranca').value = c.cobranca || '';
    document.getElementById('clientObs').value = c.observacoes || '';
    openModal('clientModal');
  }

  // ─── Ações individuais ────────────────────────────────────

  function toggleAvisado(id) {
    pushUndo();
    var clients = loadClients();
    var c = clients.find(function (cl) { return cl.id === id; });
    if (!c) return;
    c.avisado = !c.avisado;
    c.historico = c.historico || [];
    c.historico.push({ data: new Date().toISOString(), acao: c.avisado ? 'Marcado como avisado' : 'Desmarcado avisado' });
    saveClients(clients);
    renderAll();
    showToast(c.avisado ? 'Cliente marcado como avisado' : 'Aviso removido', 'info');
  }

  function toggleDebito(id) {
    pushUndo();
    var clients = loadClients();
    var c = clients.find(function (cl) { return cl.id === id; });
    if (!c) return;
    c.debito = !c.debito;
    c.historico = c.historico || [];
    c.historico.push({ data: new Date().toISOString(), acao: c.debito ? 'Marcado em débito' : 'Débito removido' });
    saveClients(clients);
    renderAll();
    showToast(c.debito ? 'Cliente marcado em débito' : 'Débito removido', 'info');
  }

  // ─── Modais ───────────────────────────────────────────────

  function openModal(id) {
    document.getElementById('modalOverlay').hidden = false;
    document.getElementById(id).hidden = false;
    // Focar primeiro input
    var modal = document.getElementById(id);
    var firstInput = modal.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea, select');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 50);
  }

  function closeModal(id) {
    document.getElementById(id).hidden = true;
    // Se nenhum modal aberto, esconder overlay
    var anyOpen = document.querySelectorAll('.modal:not([hidden])');
    if (anyOpen.length === 0) {
      document.getElementById('modalOverlay').hidden = true;
    }
  }

  function closeAllModals() {
    document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; });
    document.getElementById('modalOverlay').hidden = true;
  }

  // ─── Modal: Confirmar Exclusão ────────────────────────────

  var pendingDeleteIds = [];

  function confirmDelete(ids) {
    pendingDeleteIds = ids;
    var msg = ids.length === 1
      ? 'Tem certeza que deseja excluir este cliente?'
      : 'Tem certeza que deseja excluir ' + ids.length + ' clientes?';
    document.getElementById('deleteMsg').textContent = msg;
    openModal('deleteModal');
  }

  // ─── Modal: Renovar ───────────────────────────────────────

  var pendingRenewId = null;

  function openRenewModal(id) {
    pendingRenewId = id;
    // Pré-definir data para hoje + 30 dias
    var d = new Date();
    d.setDate(d.getDate() + 30);
    document.getElementById('renewDate').value = d.toISOString().slice(0, 10);
    document.getElementById('renewDebit').checked = false;
    openModal('renewModal');
  }

  function doRenew(id, newDate, markDebit) {
    pushUndo();
    var clients = loadClients();
    var c = clients.find(function (cl) { return cl.id === id; });
    if (!c) return;
    c.vencimento = newDate;
    if (markDebit) c.debito = true;
    c.avisado = false;
    c.historico = c.historico || [];
    c.historico.push({ data: new Date().toISOString(), acao: 'Vencimento renovado para ' + formatDate(newDate) + (markDebit ? ' (com débito)' : '') });
    saveClients(clients);
    renderAll();
    showToast('Vencimento renovado!', 'success');
  }

  // ─── Modal: Histórico ─────────────────────────────────────

  function openHistory(id) {
    var clients = loadClients();
    var c = clients.find(function (cl) { return cl.id === id; });
    if (!c) return;
    document.getElementById('historyClientName').textContent = c.nome;
    var list = document.getElementById('historyList');
    var hist = (c.historico || []).slice().reverse();
    if (hist.length === 0) {
      list.innerHTML = '<li class="history-empty">Nenhum registro de histórico.</li>';
    } else {
      list.innerHTML = hist.map(function (h) {
        var dt = new Date(h.data);
        return '<li><span class="history-date">' + dt.toLocaleString('pt-BR') + '</span> — ' + escapeHtml(h.acao) + '</li>';
      }).join('');
    }
    openModal('historyModal');
  }

  // ─── Modal: Ver Depois ────────────────────────────────────

  var pendingVerDepoisIds = [];

  function openVerDepois(id) {
    pendingVerDepoisIds = Array.isArray(id) ? id : [id];
    var d = new Date();
    d.setDate(d.getDate() + 7);
    document.getElementById('verDepoisDate').value = d.toISOString().slice(0, 10);
    openModal('verDepoisModal');
  }

  function doVerDepois(ids, date) {
    pushUndo();
    var clients = loadClients();
    clients.forEach(function (c) {
      if (ids.indexOf(c.id) !== -1) {
        c.verDepois = date;
        c.historico = c.historico || [];
        c.historico.push({ data: new Date().toISOString(), acao: 'Agendado para ver depois em ' + formatDate(date) });
      }
    });
    saveClients(clients);
    renderAll();
    showToast('Agendado para ' + formatDate(date), 'info');
  }

  // ─── Modal: Alterar Produto Individual ────────────────────

  var pendingProductId = null;

  function openChangeProduto(id) {
    pendingProductId = id;
    var clients = loadClients();
    var c = clients.find(function (cl) { return cl.id === id; });
    if (!c) return;
    document.getElementById('batchProdutoInput').value = c.produto;
    openModal('batchProdutoModal');
  }

  // ─── Ações em Lote ────────────────────────────────────────

  function batchAction(action) {
    var ids = Array.from(selectedIds);
    if (ids.length === 0) { showToast('Nenhum cliente selecionado', 'warning'); return; }

    if (action === 'excluir') { confirmDelete(ids); return; }
    if (action === 'renovar') { openBatchRenewModal(); return; }
    if (action === 'definir-produto') { pendingProductId = null; document.getElementById('batchProdutoInput').value = ''; openModal('batchProdutoModal'); return; }
    if (action === 'definir-cobranca') { document.getElementById('batchCobrancaDate').value = todayISO(); openModal('batchCobrancaModal'); return; }
    if (action === 'ver-depois') { openVerDepois(ids); return; }
    if (action === 'exportar') { exportSelected(ids); return; }

    pushUndo();
    var clients = loadClients();
    clients.forEach(function (c) {
      if (ids.indexOf(c.id) === -1) return;
      c.historico = c.historico || [];
      switch (action) {
        case 'arquivar':
          c.arquivado = true;
          c.historico.push({ data: new Date().toISOString(), acao: 'Arquivado' });
          break;
        case 'desarquivar':
          c.arquivado = false;
          c.historico.push({ data: new Date().toISOString(), acao: 'Desarquivado' });
          break;
        case 'desativar':
          c.desativado = true;
          c.historico.push({ data: new Date().toISOString(), acao: 'Desativado' });
          break;
        case 'reativar':
          c.desativado = false;
          c.historico.push({ data: new Date().toISOString(), acao: 'Reativado' });
          break;
        case 'marcar-avisado':
          c.avisado = true;
          c.historico.push({ data: new Date().toISOString(), acao: 'Marcado como avisado' });
          break;
        case 'desmarcar-avisado':
          c.avisado = false;
          c.historico.push({ data: new Date().toISOString(), acao: 'Aviso removido' });
          break;
      }
    });
    saveClients(clients);
    selectedIds.clear();
    renderAll();
    showToast('Ação aplicada a ' + ids.length + ' cliente(s)', 'success');
  }

  function openBatchRenewModal() {
    document.getElementById('batchRenewCustomDate').value = '';
    document.getElementById('batchRenewDebit').checked = false;
    openModal('batchRenewModal');
  }

  function doBatchRenew(newDate, markDebit) {
    var ids = Array.from(selectedIds);
    pushUndo();
    var clients = loadClients();
    clients.forEach(function (c) {
      if (ids.indexOf(c.id) === -1) return;
      c.vencimento = newDate;
      if (markDebit) c.debito = true;
      c.avisado = false;
      c.historico = c.historico || [];
      c.historico.push({ data: new Date().toISOString(), acao: 'Vencimento renovado em lote para ' + formatDate(newDate) });
    });
    saveClients(clients);
    selectedIds.clear();
    renderAll();
    showToast('Vencimento renovado para ' + ids.length + ' cliente(s)', 'success');
  }

  function doBatchSetProduto(produto) {
    var ids = pendingProductId ? [pendingProductId] : Array.from(selectedIds);
    if (ids.length === 0) return;
    pushUndo();
    var clients = loadClients();
    clients.forEach(function (c) {
      if (ids.indexOf(c.id) === -1) return;
      c.produto = produto;
      c.historico = c.historico || [];
      c.historico.push({ data: new Date().toISOString(), acao: 'Produto alterado para ' + produto });
    });
    saveClients(clients);
    if (!pendingProductId) selectedIds.clear();
    pendingProductId = null;
    renderAll();
    showToast('Produto atualizado!', 'success');
  }

  function doBatchSetCobranca(date) {
    var ids = Array.from(selectedIds);
    pushUndo();
    var clients = loadClients();
    clients.forEach(function (c) {
      if (ids.indexOf(c.id) === -1) return;
      c.cobranca = date;
      c.historico = c.historico || [];
      c.historico.push({ data: new Date().toISOString(), acao: 'Data de cobrança definida para ' + formatDate(date) });
    });
    saveClients(clients);
    selectedIds.clear();
    renderAll();
    showToast('Data de cobrança atualizada!', 'success');
  }

  // ─── Importar / Exportar JSON ─────────────────────────────

  function exportSelected(ids) {
    var clients = loadClients();
    var data = clients.filter(function (c) { return ids.indexOf(c.id) !== -1; });
    downloadJSON(data, 'clientes_selecionados.json');
  }

  function exportAll() {
    var clients = loadClients();
    downloadJSON(clients, 'clientes_todos.json');
  }

  function downloadJSON(data, filename) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Arquivo exportado: ' + filename, 'success');
  }

  function resolveImportedArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.clientes)) return raw.clientes;
    if (raw && Array.isArray(raw.clients)) return raw.clients;
    if (raw && Array.isArray(raw.data)) return raw.data;
    throw new Error('Formato inválido. O arquivo precisa conter uma lista de clientes.');
  }

  function mapLogToHistory(log) {
    if (!log) return null;
    if (typeof log === 'string') {
      return { data: new Date().toISOString(), acao: log };
    }
    return {
      data: log.data || log.date || log.criadoEm || new Date().toISOString(),
      acao: String(log.acao || log.action || log.mensagem || log.message || JSON.stringify(log))
    };
  }

  function normalizeImportedClient(item, clients) {
    if (!item || (!item.nome && !item.telefone)) return null;

    var rawId = item.id !== undefined && item.id !== null && String(item.id).trim() !== ''
      ? String(item.id)
      : '';
    var existing = rawId
      ? clients.find(function (c) { return String(c.id) === rawId; })
      : null;

    var historico = [];
    if (Array.isArray(item.historico)) {
      historico = item.historico.slice();
    } else if (Array.isArray(item.logs)) {
      historico = item.logs.map(mapLogToHistory).filter(Boolean);
    }

    var imported = {
      id: (!rawId || existing) ? uuid() : rawId,
      nome: String(item.nome || '').trim(),
      telefone: onlyDigits(item.telefone),
      produto: String(item.produto || item.Produto || item.produtoServico || item.servico || '').trim(),
      vencimento: parseDateInput(item.vencimento || item.data || item.Data),
      observacoes: String(item.observacoes || item.observacao || item.obs || '').trim(),
      cobranca: parseDateInput(item.cobranca || item.dataCobranca || item.DataCobranca),
      avisado: !!item.avisado,
      debito: !!item.debito,
      arquivado: !!item.arquivado,
      oculto: !!item.oculto,
      desativado: !!item.desativado,
      dola_sent: !!item.dola_sent,
      clicado: !!item.clicado,
      verDepois: parseDateInput(item.verDepois || item.reexibirEm),
      historico: historico,
      criadoEm: item.criadoEm || new Date().toISOString()
    };

    imported.historico.push({
      data: new Date().toISOString(),
      acao: 'Importado via JSON'
    });

    return imported;
  }

  function importJSON(file) {
    showLoading(true);
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var raw = JSON.parse(e.target.result);
        var data = resolveImportedArray(raw);
        pushUndo();
        var clients = loadClients();
        var count = 0;

        data.forEach(function (item) {
          var imported = normalizeImportedClient(item, clients);
          if (!imported) return;
          clients.push(imported);
          count++;
        });

        if (count === 0) throw new Error('Nenhum cliente válido encontrado no arquivo.');

        selectedIds.clear();
        saveClients(clients);
        renderAll();
        showToast(count + ' cliente(s) importado(s)!', 'success');
      } catch (err) {
        showToast('Erro ao importar: ' + err.message, 'error');
      }
      showLoading(false);
    };
    reader.onerror = function () {
      showLoading(false);
      showToast('Não foi possível ler o arquivo.', 'error');
    };
    reader.readAsText(file);
  }

  // ─── Enviar Mensagens de Cobrança ─────────────────────────

  function clientDisplayName(client) {
    var name = String(client.nome || 'cliente').trim();
    return name || 'cliente';
  }

  function greetingByTime() {
    var hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Bom dia';
    if (hour >= 12 && hour < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function monthNameFromDate(value) {
    var iso = parseDateInput(value);
    if (!iso) return '';
    var monthIndex = Number(iso.split('-')[1]) - 1;
    var months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    return months[monthIndex] || '';
  }

  function buildBillingMessage(client) {
    var vencimento = client && client.vencimento ? formatDate(client.vencimento) : 'sem data';
    var mes = client && client.vencimento ? monthNameFromDate(client.vencimento) : '';
    var mesTexto = mes ? ' (' + mes + ')' : '';

    return greetingByTime() + '! Lembrete de vencimento ' + vencimento + mesTexto +
      '.O pagamento via PIX pode ser feito no número: 11947406124 (Waldemar Jose Luiz)';
  }

  function markClientMessageSent(id) {
    pushUndo();
    var clients = loadClients();
    var c = clients.find(function (cl) { return String(cl.id) === String(id); });
    if (!c) return;

    c.avisado = true;
    c.clicado = true;
    c.dola_sent = true;
    c.historico = c.historico || [];
    c.historico.push({
      data: new Date().toISOString(),
      acao: 'Mensagem de cobrança aberta no WhatsApp'
    });

    saveClients(clients);
    renderAll();
  }

  function openWhatsAppForClient(client) {
    var number = normalizeWhatsAppNumber(client.telefone);
    if (!isValidWhatsAppNumber(client.telefone)) {
      showToast('Telefone inválido para WhatsApp: ' + (client.telefone || 'sem número'), 'warning');
      return false;
    }

    var url = 'https://wa.me/' + number + '?text=' + encodeURIComponent(buildBillingMessage(client));
    var opened = window.open(url, '_blank', 'noopener');
    if (!opened) {
      window.location.href = url;
    }
    return true;
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        var ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) resolve();
        else reject(new Error('copy_failed'));
      } catch (err) {
        document.body.removeChild(textarea);
        reject(err);
      }
    });
  }

  function copyClientMessage(id) {
    var clients = loadClients();
    var client = clients.find(function (c) { return String(c.id) === String(id); });
    if (!client) {
      showToast('Cliente não encontrado.', 'warning');
      return;
    }

    var message = buildBillingMessage(client);
    copyTextToClipboard(message).then(function () {
      showToast('Mensagem copiada para ' + clientDisplayName(client), 'success');
    }).catch(function () {
      showToast('Não foi possível copiar a mensagem neste navegador.', 'error');
    });
  }

  function sendClientMessage(id) {
    var clients = loadClients();
    var client = clients.find(function (c) { return String(c.id) === String(id); });
    if (!client) {
      showToast('Cliente não encontrado.', 'warning');
      return;
    }

    if (openWhatsAppForClient(client)) {
      markClientMessageSent(client.id);
      showToast('Cobrança aberta no WhatsApp para ' + clientDisplayName(client), 'success');
    }
  }

  function sendNextOverdue() {
    var clients = loadClients();
    var overdue = clients
      .filter(function (c) { return !c.arquivado && !c.desativado && diffDays(c.vencimento) < 0; })
      .sort(function (a, b) { return (a.vencimento || '').localeCompare(b.vencimento || ''); });

    if (overdue.length === 0) {
      showToast('Nenhum cliente vencido encontrado!', 'warning');
      return;
    }

    sendClientMessage(overdue[0].id);
  }

  // ─── Toast ────────────────────────────────────────────────

  function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('fade-out');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // ─── Loading ──────────────────────────────────────────────

  function showLoading(show) {
    var el = document.getElementById('loadingOverlay');
    if (el) el.hidden = !show;
  }

  // ─── Configurações ────────────────────────────────────────

  function applyTheme() {
    var cfg = loadConfig();
    document.documentElement.style.setProperty('--color-primary', cfg.primaryColor);
    document.documentElement.style.setProperty('--color-accent', cfg.accentColor);
    if (cfg.darkMode) {
      document.body.setAttribute('data-theme', 'dark');
    } else {
      document.body.removeAttribute('data-theme');
    }

    // Atualizar campos do modal de configurações
    var prim = document.getElementById('themePrimary');
    var acc = document.getElementById('themeAccent');
    var dark = document.getElementById('darkModeToggle');
    if (prim) prim.value = cfg.primaryColor;
    if (acc) acc.value = cfg.accentColor;
    if (dark) dark.checked = cfg.darkMode;

    loadSettingsForm();
    applyVisibilitySettings();
  }

  function saveSettings() {
    var cfg = loadConfig();
    cfg.primaryColor = document.getElementById('themePrimary').value;
    cfg.accentColor = document.getElementById('themeAccent').value;
    cfg.darkMode = document.getElementById('darkModeToggle').checked;

    cfg.visibleColumns = Object.assign({}, cfg.visibleColumns || {});
    document.querySelectorAll('[data-column-toggle]').forEach(function (input) {
      cfg.visibleColumns[input.dataset.columnToggle] = input.checked;
    });

    cfg.visibleActions = Object.assign({}, cfg.visibleActions || {});
    document.querySelectorAll('[data-action-toggle]').forEach(function (input) {
      cfg.visibleActions[input.dataset.actionToggle] = input.checked;
    });

    saveConfig(cfg);
    applyTheme();
    renderTable();
    closeModal('settingsModal');
    showToast('Configurações salvas!', 'success');
  }

  // ─── PWA – Instalação ─────────────────────────────────────

  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var installBtn = document.getElementById('installBtn');
    var installMenuBtn = document.getElementById('installMenuBtn');
    if (installBtn) installBtn.hidden = false;
    if (installMenuBtn) installMenuBtn.disabled = false;
  });

  // ─── Registro do Service Worker ───────────────────────────

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').then(function (reg) {
        console.log('Service Worker registrado:', reg.scope);
      }).catch(function (err) {
        console.log('Erro ao registrar SW:', err);
      });
    });
  }

  // ─── Inicialização & Bind de Eventos ──────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme();
    applyDesktopViewPreference();
    ensureGoogleSheetsControls();
    renderAll();
    setFilter(currentFilter);

    var toggleMobileFiltersBtn = document.getElementById('toggleMobileFilters');
    if (toggleMobileFiltersBtn) {
      toggleMobileFiltersBtn.addEventListener('click', toggleMobileFilters);
      setMobileFiltersCollapsed(true);
    }

    loadClientsFromGoogleSheets({ silent: true });

    // No celular o menu começa fechado para não cobrir a lista.
    var initialSidebar = document.getElementById('sidebar');
    if (initialSidebar && !isDesktopViewForced() && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      initialSidebar.classList.add('collapsed');
    }

    // ── Sidebar toggle
    document.getElementById('toggleSidebar').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    // Evita fechar/aplicar filtro quando o usuário apenas arrasta/rola o menu no celular.
    var sidebar = document.getElementById('sidebar');
    var sidebarPointerStartX = 0;
    var sidebarPointerStartY = 0;
    var sidebarPointerDragged = false;
    var sidebarIgnoreClickUntil = 0;

    function isSidebarScrollClick() {
      return Date.now() < sidebarIgnoreClickUntil || sidebarPointerDragged;
    }

    if (sidebar) {
      sidebar.addEventListener('pointerdown', function (event) {
        sidebarPointerStartX = event.clientX || 0;
        sidebarPointerStartY = event.clientY || 0;
        sidebarPointerDragged = false;
      }, { passive: true });

      sidebar.addEventListener('pointermove', function (event) {
        var dx = Math.abs((event.clientX || 0) - sidebarPointerStartX);
        var dy = Math.abs((event.clientY || 0) - sidebarPointerStartY);
        if (dx > 8 || dy > 8) {
          sidebarPointerDragged = true;
          sidebarIgnoreClickUntil = Date.now() + 450;
        }
      }, { passive: true });

      sidebar.addEventListener('scroll', function () {
        sidebarPointerDragged = true;
        sidebarIgnoreClickUntil = Date.now() + 450;
      }, { passive: true });

      // Se um arrasto gerar um "click" ao soltar o dedo, cancela antes dos botões receberem.
      sidebar.addEventListener('click', function (event) {
        if (isSidebarScrollClick()) {
          event.preventDefault();
          event.stopPropagation();
          sidebarPointerDragged = false;
        }
      }, true);
    }

    // ── Filtros da sidebar
    document.querySelectorAll('.sidebar-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (isSidebarScrollClick()) return;
        setFilter(btn.dataset.filter);
        closeSidebarOnMobile();
      });
    });

    // Fecha o menu no celular somente depois de um toque real em botão/link.
    if (sidebar) {
      sidebar.addEventListener('click', function (event) {
        if (isSidebarScrollClick()) return;
        var chosen = event.target.closest('button, a');
        if (!chosen || chosen.id === 'toggleSidebar') return;
        if (chosen.closest('#sidebar')) {
          setTimeout(closeSidebarOnMobile, 80);
        }
      });
    }

    window.addEventListener('resize', function () {
      applyDesktopViewPreference();
      var s = document.getElementById('sidebar');
      if (s && !isDesktopViewForced() && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
        s.classList.add('collapsed');
      }
      if (!isDesktopViewForced() && isMobileFilterLayout()) {
        setMobileFiltersCollapsed(true);
      }
    });

    // ── Busca
    var searchInput = document.getElementById('searchInput');
    var clearSearchBtn = document.getElementById('clearSearchBtn');

    function syncSearchClearButton() {
      if (clearSearchBtn) {
        clearSearchBtn.hidden = !searchInput.value;
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        currentSearch = this.value;
        syncSearchClearButton();
        renderTable();
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', function () {
        searchInput.value = '';
        currentSearch = '';
        syncSearchClearButton();
        renderTable();
        searchInput.focus();
      });
    }

    syncSearchClearButton();

    // ── Filtro de produto
    document.getElementById('filterProduto').addEventListener('change', function () {
      currentProdutoFilter = this.value;
      renderTable();
    });

    // ── Filtro de vencimento
    document.getElementById('filterVencimento').addEventListener('change', function () {
      currentVencimentoFilter = this.value;
      renderTable();
    });

    // ── Select All checkbox
    document.getElementById('selectAll').addEventListener('change', function () {
      selectAll(this.checked);
    });

    // ── Abrir modal adicionar
    document.getElementById('addClientBtn').addEventListener('click', function () {
      document.getElementById('clientModalTitle').textContent = 'Adicionar Cliente';
      document.getElementById('clientForm').reset();
      document.getElementById('clientId').value = '';
      openModal('clientModal');
    });
    var emptyAdd = document.getElementById('emptyAddBtn');
    if (emptyAdd) {
      emptyAdd.addEventListener('click', function () {
        document.getElementById('addClientBtn').click();
      });
    }

    // ── Form submit (Adicionar / Editar)
    document.getElementById('clientForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        nome: document.getElementById('clientNome').value,
        telefone: document.getElementById('clientTelefone').value,
        produto: document.getElementById('clientProduto').value,
        vencimento: document.getElementById('clientVencimento').value,
        cobranca: document.getElementById('clientCobranca').value,
        observacoes: document.getElementById('clientObs').value
      };
      var id = document.getElementById('clientId').value;
      if (id) updateClient(id, data);
      else addClient(data);
      closeModal('clientModal');
      this.reset();
    });

    // ── Confirmar exclusão
    document.getElementById('confirmDeleteBtn').addEventListener('click', function () {
      deleteClients(pendingDeleteIds);
      closeModal('deleteModal');
      pendingDeleteIds = [];
    });

    // ── Confirmar renovação
    document.getElementById('confirmRenewBtn').addEventListener('click', function () {
      var date = document.getElementById('renewDate').value;
      var debit = document.getElementById('renewDebit').checked;
      if (!date) { showToast('Selecione uma data', 'warning'); return; }
      doRenew(pendingRenewId, date, debit);
      closeModal('renewModal');
      pendingRenewId = null;
    });

    // ── Confirmar Ver Depois
    document.getElementById('confirmVerDepoisBtn').addEventListener('click', function () {
      var date = document.getElementById('verDepoisDate').value;
      if (!date) { showToast('Selecione uma data', 'warning'); return; }
      doVerDepois(pendingVerDepoisIds, date);
      closeModal('verDepoisModal');
    });

    // ── Confirmar Produto em lote
    document.getElementById('confirmBatchProdutoBtn').addEventListener('click', function () {
      var produto = document.getElementById('batchProdutoInput').value.trim();
      if (!produto) { showToast('Informe o produto', 'warning'); return; }
      doBatchSetProduto(produto);
      closeModal('batchProdutoModal');
    });

    // ── Confirmar Cobrança em lote
    document.getElementById('confirmBatchCobrancaBtn').addEventListener('click', function () {
      var date = document.getElementById('batchCobrancaDate').value;
      if (!date) { showToast('Selecione uma data', 'warning'); return; }
      doBatchSetCobranca(date);
      closeModal('batchCobrancaModal');
    });

    // ── Batch renew modal
    document.getElementById('batchRenewToday').addEventListener('click', function () {
      doBatchRenew(todayISO(), document.getElementById('batchRenewDebit').checked);
      closeModal('batchRenewModal');
    });
    document.getElementById('batchRenewNextMonth').addEventListener('click', function () {
      var d = new Date(); d.setDate(d.getDate() + 30);
      doBatchRenew(d.toISOString().slice(0, 10), document.getElementById('batchRenewDebit').checked);
      closeModal('batchRenewModal');
    });
    document.getElementById('confirmBatchRenewBtn').addEventListener('click', function () {
      var date = document.getElementById('batchRenewCustomDate').value;
      if (!date) { showToast('Selecione uma data', 'warning'); return; }
      doBatchRenew(date, document.getElementById('batchRenewDebit').checked);
      closeModal('batchRenewModal');
    });

    // ── Batch action buttons
    document.querySelectorAll('[data-batch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        batchAction(btn.dataset.batch);
      });
    });

    // ── Undo / Redo
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);

    // ── Atalhos de teclado
    document.addEventListener('keydown', function (e) {
      // ESC fecha modais
      if (e.key === 'Escape') closeAllModals();
      // Ctrl+Z = undo
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      // Ctrl+Y = redo
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    });

    // ── Fechar modal com botões de close
    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeModal(btn.dataset.close);
      });
    });

    // ── Fechar modal clicando no overlay
    document.getElementById('modalOverlay').addEventListener('click', closeAllModals);

    // ── Enviar msg próximo vencido
    document.getElementById('sendNextOverdue').addEventListener('click', sendNextOverdue);

    // ── Instalar PWA
    function handleInstallClick() {
      if (!deferredPrompt) {
        showToast('Se o botão de instalação não abrir, use o menu do navegador e escolha "Instalar app" ou "Adicionar à tela inicial".', 'info');
        return;
      }

      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (result) {
        if (result.outcome === 'accepted') showToast('App instalado!', 'success');
        deferredPrompt = null;
        var installBtn = document.getElementById('installBtn');
        var installMenuBtn = document.getElementById('installMenuBtn');
        if (installBtn) installBtn.hidden = true;
        if (installMenuBtn) installMenuBtn.disabled = false;
      });
    }

    var headerInstallBtn = document.getElementById('installBtn');
    var menuInstallBtn = document.getElementById('installMenuBtn');
    if (headerInstallBtn) headerInstallBtn.addEventListener('click', handleInstallClick);
    if (menuInstallBtn) menuInstallBtn.addEventListener('click', handleInstallClick);

    var desktopViewBtn = document.getElementById('desktopViewBtn');
    if (desktopViewBtn) desktopViewBtn.addEventListener('click', toggleDesktopView);

    // ── Importar JSON
    document.getElementById('importBtn').addEventListener('click', function () {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', function () {
      if (this.files.length > 0) importJSON(this.files[0]);
      this.value = '';
    });

    // ── Exportar tudo
    document.getElementById('exportAllBtn').addEventListener('click', exportAll);

    // ── Google Sheets
    var syncSheetsBtn = document.getElementById('syncSheetsBtn');
    if (syncSheetsBtn) {
      syncSheetsBtn.addEventListener('click', function () {
        loadClientsFromGoogleSheets({ silent: false });
      });
    }
    var pushSheetsBtn = document.getElementById('pushSheetsBtn');
    if (pushSheetsBtn) {
      pushSheetsBtn.addEventListener('click', function () {
        syncClientsToGoogleSheets(loadClients(), { force: true, showToast: true });
      });
    }

    // ── Configurações
    document.getElementById('settingsBtn').addEventListener('click', function () {
      applyTheme(); // carrega valores atuais nos inputs
      openModal('settingsModal');
    });
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

    // ── Avisos de conectividade
    window.addEventListener('online', function () {
      showToast('Conexão restabelecida. Sincronizando com Google Sheets...', 'success');
      queueGoogleSheetsSave(loadClients());
    });
    window.addEventListener('offline', function () {
      setSheetsStatus('Sheets: offline', 'warning');
      showToast('Você está offline. Os dados continuam funcionando neste aparelho.', 'warning');
    });

    // ── Limpar todos os dados
    document.getElementById('clearAllData').addEventListener('click', function () {
      if (confirm('ATENÇÃO: Isso apagará TODOS os clientes locais e também enviará a lista vazia ao Google Sheets. Deseja continuar?')) {
        localStorage.setItem(KEYS.clients, JSON.stringify([]));
        localStorage.removeItem(KEYS.config);
        localStorage.removeItem(KEYS.undoStack);
        localStorage.removeItem(KEYS.redoStack);
        sheetsLastSavedSignature = '';
        selectedIds.clear();
        renderAll();
        syncClientsToGoogleSheets([], { force: true, showToast: true });
        closeModal('settingsModal');
        showToast('Todos os dados foram apagados', 'warning');
      }
    });

    // ── Última atualização
    var cfg = loadConfig();
    if (cfg.lastModified) {
      document.getElementById('lastUpdate').textContent = 'Atualizado: ' + cfg.lastModified;
    }
  });

})();
