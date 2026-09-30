import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SITE_URL } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { headers: { 'X-Client-Info': 'juntos-web/1.0.0' } }
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const money = value => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(value || 0));
const shortDate = value => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T12:00:00`)) : 'Sem data';
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' }).format(new Date(value)) : 'Sem data';
const todayISO = () => new Date().toISOString().slice(0, 10);
const brDate = value => value ? value.split('-').reverse().join('/') : '';
const isoDate = value => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match=String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const state = {
  session: null, profile: null, membership: null, household: null,
  scope: 'shared', view: 'home', financeTab: 'transacoes', calendarDate: new Date(),
  data: { accounts:[], cards:[], transactions:[], categories:[], tasks:[], goals:[], events:[], budgets:[], recurring:[], members:[], profiles:[] }
};
const FINANCIAL_SYNC_TABLES = new Set(['accounts','cards','transactions','budgets','goals','recurring_expenses']);

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.className = 'toast', 3500);
}

function setBusy(button, busy, label = 'Aguarde…') {
  if (!button) return;
  if (busy) { button.dataset.original = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.original || button.textContent; button.disabled = false; }
}

function showAuth(tab = 'login') {
  $('#auth-modal').hidden = false;
  switchAuthTab(tab);
  setTimeout(() => $(`#${tab === 'signup' ? 'signup-name' : 'login-email'}`)?.focus(), 30);
}

function hideAuth() { $('#auth-modal').hidden = true; $('#auth-message').textContent = ''; }
function hideForm() { $('#form-modal').hidden = true; $('#dynamic-form').replaceChildren(); }

function switchAuthTab(tab) {
  $$('[data-auth-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.authTab === tab));
  $('#login-form').hidden = tab !== 'login';
  $('#signup-form').hidden = tab !== 'signup';
  $('#reset-form').hidden = tab !== 'reset';
  $('#auth-title').textContent = tab === 'signup' ? 'Vamos começar juntos' : tab === 'reset' ? 'Crie uma nova senha' : 'Que bom ter você aqui';
  $('#auth-subtitle').textContent = tab === 'signup' ? 'Sua casa começa com uma conta individual.' : tab === 'reset' ? 'Escolha uma senha forte e exclusiva.' : 'Entre para acessar sua casa.';
  $('.auth-tabs').hidden = tab === 'reset';
  $('#auth-message').textContent = '';
}

async function authenticate() {
  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { showAuth('reset'); return; }
    setTimeout(() => handleSession(session), 0);
  });
}

async function handleSession(session) {
  state.session = session;
  if (!session) {
    $('#public-shell').hidden = false;
    $('#app-shell').hidden = true;
    return;
  }
  hideAuth();
  $('#public-shell').hidden = true;
  $('#app-shell').hidden = false;
  $('#app-content').innerHTML = loading();
  try {
    const [{ data: profile, error: profileError }, { data: memberships, error: memberError }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('household_members').select('household_id,role,joined_at,households(id,name,created_by,created_at)').eq('user_id', session.user.id).order('joined_at').limit(1)
    ]);
    if (profileError) throw profileError;
    if (memberError) throw memberError;
    state.profile = profile || { display_name: session.user.user_metadata?.display_name || session.user.email.split('@')[0] };
    state.membership = memberships?.[0] || null;
    state.household = state.membership?.households || null;
    updateIdentity();
    if (!state.household) { renderOnboarding(); return; }
    await refreshData();
  } catch (error) { showAppError(error); }
}

function updateIdentity() {
  const name = state.profile?.display_name || 'Usuário';
  $('#user-name').textContent = name.split(' ')[0];
  $('#user-initial').textContent = name.charAt(0).toUpperCase();
  $('#today-label').textContent = new Intl.DateTimeFormat('pt-BR', { weekday:'long', day:'2-digit', month:'long' }).format(new Date());
}

function loading(text = 'Organizando sua casa…') { return `<div class="loading-state"><div><div class="spinner"></div><p>${esc(text)}</p></div></div>`; }
function empty(title, text, action = '') { return `<div class="empty-state"><div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div></div>`; }
function showAppError(error) {
  console.error('Juntos error:', error?.code || error?.message || error);
  $('#app-content').innerHTML = empty('Não foi possível carregar', 'Confira sua conexão e tente novamente.', '<button class="btn btn-primary" data-action="reload">Tentar novamente</button>');
  toast(friendlyError(error), 'error');
}
function friendlyError(error) {
  const message = String(error?.message || error || 'Erro inesperado');
  if (/invalid login/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
  if (/already registered/i.test(message)) return 'Este e-mail já está cadastrado.';
  if (/rate limit/i.test(message)) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (/row-level security|permission denied|access denied/i.test(message)) return 'Você não tem permissão para essa ação.';
  if (/network|fetch/i.test(message)) return 'Sem conexão com o servidor.';
  return 'Não foi possível concluir. Tente novamente.';
}

async function refreshData() {
  if (!state.household) return;
  $('#app-content').innerHTML = loading();
  const hid = state.household.id;
  const [{data:records,error:syncError},{data:members,error:memberError}] = await Promise.all([
    supabase.from('juntos_sync_records').select('record_id,table_name,payload,deleted,updated_at,updated_by').eq('household_id',hid).eq('deleted',false).order('updated_at',{ascending:false}).limit(10000),
    supabase.from('household_members').select('user_id,role,joined_at').eq('household_id',hid)
  ]);
  if(syncError)throw syncError;
  if(memberError)throw memberError;
  state.data={accounts:[],cards:[],transactions:[],categories:[],tasks:[],goals:[],events:[],budgets:[],recurring:[],members:members||[],profiles:[]};
  for(const row of records||[]){
    const mapped=syncRecord(row);
    if(mapped)state.data[mapped.collection].push(mapped.item);
  }
  state.data.transactions.sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date)));
  state.data.events.sort((a,b)=>String(a.starts_at).localeCompare(String(b.starts_at)));
  const ids = state.data.members.map(item => item.user_id);
  if (ids.length) {
    const { data, error } = await supabase.from('profiles').select('id,display_name,avatar_url').in('id', ids);
    if (error) throw error;
    state.data.profiles = data || [];
  }
  renderCurrentView();
}

function syncRecord(row){
  const p=row.payload||{};const id=row.record_id;const common={id,created_by:p.owner_uid||row.updated_by,owner_user_id:p.owner_uid||row.updated_by,scope:p.scope||'personal',_payload:p,_syncTable:row.table_name,updated_at:row.updated_at};
  if(row.table_name==='categories')return{collection:'categories',item:{...common,name:p.name||'Outros',kind:String(p.kind||'Despesa').toLowerCase().startsWith('rece')?'income':'expense',is_active:Number(p.active??1)===1}};
  if(row.table_name==='accounts')return{collection:'accounts',item:{...common,name:p.name||'Conta',type:normalizeAccountType(p.type),initial_balance:Number(p.balance||0),balance:Number(p.balance||0),is_active:Number(p.active??1)===1}};
  if(row.table_name==='cards')return{collection:'cards',item:{...common,name:p.name||'Cartão',credit_limit:Number(p.credit_limit||0),closing_day:Number(p.closing_day||1),due_day:Number(p.due_day||1),last_four:p.last_four||'',is_active:Number(p.active??1)===1}};
  if(row.table_name==='transactions')return{collection:'transactions',item:{...common,description:p.description||'Movimentação',amount:Number(p.amount||0),type:normalizeTransactionType(p.type),transaction_date:isoDate(p.date||p.due_date),categories:{name:p.category||'Sem categoria'},accounts:{name:p.account||''},credit_cards:{name:p.card||''},account_name:p.account||'',card_name:p.card||'',notes:p.notes||''}};
  if(row.table_name==='tasks')return{collection:'tasks',item:{...common,title:p.title||'Tarefa',description:p.description||'',assigned_to:memberIdByName(p.responsible),responsible_name:p.responsible||'',due_date:isoDate(p.due),priority:normalizePriority(p.priority),status:String(p.status||'Pendente').toLowerCase().startsWith('concl')?'done':'todo',recurrence:p.recurrence||null,completed_at:p.completed_at||null}};
  if(row.table_name==='events'){const day=isoDate(p.date);const time=/^\d{2}:\d{2}/.test(p.time||'')?p.time.slice(0,5):'00:00';return{collection:'events',item:{...common,title:p.title||'Compromisso',starts_at:day?`${day}T${time}:00`:row.updated_at,ends_at:null,location:p.location||'',description:p.notes||'',responsible_user_id:memberIdByName(p.responsible)}};}
  if(row.table_name==='budgets')return{collection:'budgets',item:{...common,amount:Number(p.amount||0),month:/^\d{4}-\d{2}$/.test(p.month||'')?`${p.month}-01`:isoDate(p.month),categories:{name:p.category||'Categoria'}}};
  if(row.table_name==='goals')return{collection:'goals',item:{...common,name:p.name||'Meta',target_amount:Number(p.target||0),current_amount:Number(p.current||0),target_date:isoDate(p.target_date),completed:Number(p.done||0)===1}};
  if(row.table_name==='recurring_expenses')return{collection:'recurring',item:{...common,type:'expense',description:p.description||'Despesa fixa',amount:Number(p.amount||0),next_date:isoDate(p.start_date),frequency:normalizeFrequency(p.frequency),categories:{name:p.category||'Outros'},account_name:p.account||'',active:Number(p.active??1)===1}};
  return null;
}
function normalizeTransactionType(value){const v=String(value||'').toLowerCase();return v.startsWith('rece')?'income':v.startsWith('trans')?'transfer':'expense';}
function normalizePriority(value){const v=String(value||'').toLowerCase();return v.startsWith('alt')?'high':v.startsWith('baix')?'low':'medium';}
function normalizeFrequency(value){const v=String(value||'').toLowerCase();return v.startsWith('seman')?'weekly':v.startsWith('quinz')?'biweekly':v.startsWith('anual')?'yearly':'monthly';}
function normalizeAccountType(value){const v=String(value||'').toLowerCase();return v.includes('poup')?'savings':v.includes('dinheiro')?'cash':v.includes('invest')?'investment':v.includes('corrent')?'checking':'other';}
function memberIdByName(name){const target=String(name||'').trim().toLowerCase();if(!target)return null;return state.data?.profiles?.find(p=>String(p.display_name||'').toLowerCase()===target)?.id||null;}

function scoped(items, ownerField = 'created_by') {
  if (state.scope === 'shared') return items.filter(item => FINANCIAL_SYNC_TABLES.has(item._syncTable) || !('scope' in item) || item.scope === 'shared');
  return items.filter(item => !('scope' in item) ? item[ownerField] === state.session.user.id : item.scope === 'personal' && (item[ownerField] || item.owner_user_id) === state.session.user.id);
}

function ownerName(item){return memberName(item.owner_user_id||item.created_by)||'Pessoal';}
function scopeLabel(item){return item.scope==='shared'?'Casal':ownerName(item);}
function canEdit(item){return item.scope==='shared'||(item.owner_user_id||item.created_by)===state.session.user.id;}

function calculateAccountBalance(account) {
  return state.data.transactions.reduce((total, tx) => {
    if (tx.account_id === account.id || (tx.account_name&&tx.account_name===account.name)) total += tx.type === 'income' ? Number(tx.amount) : tx.type === 'expense' ? -Number(tx.amount) : -Number(tx.amount);
    if (tx.type === 'transfer' && tx.destination_account_id === account.id) total += Number(tx.amount);
    return total;
  }, Number(account.initial_balance ?? account.balance ?? 0));
}

function renderCurrentView() {
  const names = {home:'Início',financas:'Finanças',agenda:'Agenda',tarefas:'Tarefas',metas:'Metas',perfil:'Perfil e casa'};
  $('#view-title').textContent = names[state.view] || 'Juntos';
  $$('[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === state.view));
  $$('[data-scope]').forEach(btn => btn.classList.toggle('active', btn.dataset.scope === state.scope));
  const renderers = { home:renderHome, financas:renderFinance, agenda:renderAgenda, tarefas:renderTasks, metas:renderGoals, perfil:renderProfile };
  $('#app-content').innerHTML = (renderers[state.view] || renderHome)();
}

function renderHome() {
  const accounts = scoped(state.data.accounts, 'owner_user_id');
  const txs = scoped(state.data.transactions);
  const month = todayISO().slice(0,7);
  const monthTx = txs.filter(tx => tx.transaction_date?.startsWith(month));
  const income = monthTx.filter(tx => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount), 0);
  const expense = monthTx.filter(tx => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount), 0);
  const balance = accounts.reduce((sum, account) => sum + calculateAccountBalance(account), 0);
  const pendingTasks = scoped(state.data.tasks).filter(task => task.status !== 'done').slice(0,4);
  const upcoming = scoped(state.data.events).filter(event => new Date(event.starts_at) >= new Date(Date.now()-86400000)).slice(0,4);
  const goals = scoped(state.data.goals).filter(goal => !goal.completed).slice(0,3);
  const recent = txs.slice(0,5);
  return `<div class="dashboard-grid">
    <article class="card balance-card"><small>Saldo das contas · ${state.scope === 'shared' ? 'Casal' : 'Pessoal'}</small><h2>${money(balance)}</h2><span>${accounts.length} ${accounts.length === 1 ? 'conta ativa' : 'contas ativas'}</span><div class="balance-footer"><div><small>Entradas no mês</small><b>${money(income)}</b></div><div><small>Saídas no mês</small><b>${money(expense)}</b></div></div></article>
    <article class="card summary-card"><div class="card-head"><h2>Resumo de ${new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(new Date())}</h2><button data-view="financas">Detalhes</button></div><div class="summary-numbers"><div class="stat income"><span>Receitas</span><strong>${money(income)}</strong></div><div class="stat expense"><span>Despesas</span><strong>${money(expense)}</strong></div></div><p>Resultado do período: <b class="${income-expense >= 0 ? 'amount income':'amount expense'}">${money(income-expense)}</b></p></article>
    <article class="card section-card"><div class="card-head"><h3>Movimentações recentes</h3><button data-action="open-form" data-form="transaction">Adicionar</button></div>${recent.length ? `<div class="list">${recent.map(transactionRow).join('')}</div>` : empty('Nada por aqui','Adicione sua primeira receita ou despesa.')}</article>
    <article class="card section-card"><div class="card-head"><h3>Tarefas pendentes</h3><button data-view="tarefas">Ver todas</button></div>${pendingTasks.length ? `<div class="list">${pendingTasks.map(taskRow).join('')}</div>` : empty('Tudo em dia','Nenhuma tarefa pendente nesta visão.')}</article>
    <article class="card section-card"><div class="card-head"><h3>Próximos compromissos</h3><button data-view="agenda">Abrir agenda</button></div>${upcoming.length ? `<div class="list">${upcoming.map(eventRow).join('')}</div>` : empty('Agenda livre','Adicione um compromisso para começar.')}</article>
    <article class="card section-card"><div class="card-head"><h3>Metas em andamento</h3><button data-view="metas">Ver metas</button></div>${goals.length ? goals.map(goalProgress).join('') : empty('Sonhos ganham forma','Crie uma meta financeira.')}</article>
  </div>`;
}

function transactionRow(tx) {
  const type = tx.type === 'income' ? 'income' : 'expense';
  const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '↔';
  return `<div class="list-row"><span class="list-icon">${sign}</span><div class="list-main"><b>${esc(tx.description)}</b><small>${shortDate(tx.transaction_date)} · ${esc(tx.categories?.name || tx.accounts?.name || 'Sem categoria')} · ${esc(scopeLabel(tx))}</small></div><span class="amount ${type}">${tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}${money(tx.amount)}</span>${canEdit(tx)?`<button class="icon-button" data-delete="transactions" data-id="${esc(tx.id)}" aria-label="Excluir">×</button>`:''}</div>`;
}
function taskRow(task) { return `<div class="list-row"><button class="task-check ${task.status === 'done' ? 'done':''}" data-complete-task="${esc(task.id)}">${task.status === 'done' ? '✓':''}</button><div class="list-main"><b>${esc(task.title)}</b><small>${shortDate(task.due_date)} · ${esc(memberName(task.assigned_to) || task.responsible_name || 'Sem responsável')}</small></div><span class="badge ${esc(task.priority)}">${task.priority === 'high'?'Alta':task.priority === 'low'?'Baixa':'Média'}</span></div>`; }
function eventRow(event) { return `<div class="list-row"><span class="list-icon">□</span><div class="list-main"><b>${esc(event.title)}</b><small>${dateTime(event.starts_at)}${event.location ? ` · ${esc(event.location)}`:''}</small></div><button class="icon-button" data-delete="calendar_events" data-id="${esc(event.id)}" aria-label="Excluir">×</button></div>`; }
function goalProgress(goal) { const pct=Math.min(100,Math.round((Number(goal.current_amount||0)/Number(goal.target_amount||1))*100));return `<div class="goal-mini"><div class="card-head"><span><b>${esc(goal.name)}</b><small> · ${money(goal.current_amount)} de ${money(goal.target_amount)}</small></span><b>${pct}%</b></div><progress class="progress-bar" max="100" value="${pct}">${pct}%</progress></div>`; }
function memberName(id){return state.data.profiles.find(p=>p.id===id)?.display_name||'';}

function renderFinance() {
  const tabs = [['transacoes','Transações'],['contas','Contas'],['cartoes','Cartões'],['orcamento','Orçamento'],['recorrentes','Fixas e recorrentes']];
  let content = '';
  if (state.financeTab === 'transacoes') {
    const txs = scoped(state.data.transactions);
    content = txs.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Descrição</th><th>Data</th><th>Categoria</th><th>Responsável</th><th>Valor</th><th></th></tr></thead><tbody>${txs.map(tx=>`<tr><td><b>${esc(tx.description)}</b></td><td>${shortDate(tx.transaction_date)}</td><td>${esc(tx.categories?.name||'—')}</td><td><span class="badge">${esc(scopeLabel(tx))}</span></td><td class="amount ${tx.type==='income'?'income':'expense'}">${tx.type==='expense'?'−':'+'}${money(tx.amount)}</td><td>${canEdit(tx)?`<button class="icon-button" data-delete="transactions" data-id="${esc(tx.id)}">×</button>`:''}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhuma movimentação','Registre uma receita ou despesa.');
  } else if (state.financeTab === 'contas') {
    const items=scoped(state.data.accounts,'owner_user_id'); content=items.length?`<div class="data-grid">${items.map(a=>`<article class="account-card"><span class="badge">${esc(scopeLabel(a))}</span><h3>${esc(a.name)}</h3><p>${accountType(a.type)}</p><strong>${money(calculateAccountBalance(a))}</strong>${canEdit(a)?`<p><button class="link-button" data-delete="accounts" data-id="${esc(a.id)}">Arquivar conta</button></p>`:''}</article>`).join('')}</div>`:empty('Nenhuma conta sincronizada','Sincronize o aplicativo para trazer as contas e os saldos.');
  } else if (state.financeTab === 'cartoes') {
    const items=scoped(state.data.cards,'owner_user_id'); content=items.length?`<div class="data-grid">${items.map(c=>`<article class="account-card"><span class="badge">${esc(scopeLabel(c))} · final ${esc(c.last_four||'••••')}</span><h3>${esc(c.name)}</h3><p>Fecha dia ${c.closing_day} · vence dia ${c.due_day}</p><strong>${money(c.credit_limit||0)}</strong><p>Limite cadastrado</p>${canEdit(c)?`<button class="link-button" data-delete="credit_cards" data-id="${esc(c.id)}">Arquivar cartão</button>`:''}</article>`).join('')}</div>`:empty('Nenhum cartão','Cadastre apenas nome, limite e datas — nunca o número completo.');
  } else if (state.financeTab === 'orcamento') {
    const items=scoped(state.data.budgets); content=items.length?`<div class="data-grid">${items.map(b=>`<article class="account-card"><span class="badge">${shortDate(b.month)} · ${esc(scopeLabel(b))}</span><h3>${esc(b.categories?.name||'Categoria')}</h3><strong>${money(b.amount)}</strong><p>Limite do mês</p>${canEdit(b)?`<button class="link-button" data-delete="budgets" data-id="${esc(b.id)}">Excluir</button>`:''}</article>`).join('')}</div>`:empty('Sem orçamento definido','Defina limites mensais por categoria.');
  } else {
    const items=scoped(state.data.recurring); content=items.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Descrição</th><th>Tipo</th><th>Próxima data</th><th>Frequência</th><th>Valor</th></tr></thead><tbody>${items.map(r=>`<tr><td><b>${esc(r.description)}</b></td><td>${r.type==='income'?'Receita':'Despesa'}</td><td>${shortDate(r.next_date)}</td><td>${frequency(r.frequency)}</td><td>${money(r.amount)}</td></tr>`).join('')}</tbody></table></div>`:empty('Nenhum item recorrente','As despesas fixas cadastradas aparecerão aqui.');
  }
  const formMap={transacoes:'transaction',contas:'account',cartoes:'card',orcamento:'budget',recorrentes:'recurring'};
  return `<div class="page-heading"><div><h2>Seu dinheiro, sem complicação</h2><p>Acompanhe a visão ${state.scope==='shared'?'do casal':'pessoal'}.</p></div><button class="btn btn-primary" data-action="open-form" data-form="${formMap[state.financeTab]}">＋ Adicionar</button></div><div class="subtabs">${tabs.map(([id,label])=>`<button class="${state.financeTab===id?'active':''}" data-finance-tab="${id}">${label}</button>`).join('')}</div>${content}`;
}
function accountType(type){return({checking:'Conta corrente',savings:'Poupança',cash:'Dinheiro',investment:'Investimento',other:'Outra'})[type]||type;}
function frequency(value){return({weekly:'Semanal',biweekly:'Quinzenal',monthly:'Mensal',yearly:'Anual',custom:'Personalizada'})[value]||value;}

function renderTasks() {
  const tasks=scoped(state.data.tasks);const pending=tasks.filter(t=>t.status!=='done');const done=tasks.filter(t=>t.status==='done');
  return `<div class="page-heading"><div><h2>Tarefas da casa</h2><p>Responsabilidades claras deixam a rotina mais leve.</p></div><button class="btn btn-primary" data-action="open-form" data-form="task">＋ Nova tarefa</button></div><div class="dashboard-grid"><article class="card section-card"><div class="card-head"><h3>Pendentes · ${pending.length}</h3></div>${pending.length?`<div class="list">${pending.map(taskRow).join('')}</div>`:empty('Tudo concluído','Bom trabalho!')}</article><article class="card section-card"><div class="card-head"><h3>Concluídas · ${done.length}</h3></div>${done.length?`<div class="list">${done.slice(0,12).map(taskRow).join('')}</div>`:empty('Nenhuma ainda','As tarefas finalizadas aparecerão aqui.')}</article></div>`;
}

function renderGoals() {
  const goals=scoped(state.data.goals);
  return `<div class="page-heading"><div><h2>Metas que aproximam</h2><p>Transforme planos em pequenos avanços visíveis.</p></div><button class="btn btn-primary" data-action="open-form" data-form="goal">＋ Nova meta</button></div>${goals.length?`<div class="data-grid">${goals.map(g=>{const pct=Math.min(100,Math.round(Number(g.current_amount||0)/Number(g.target_amount||1)*100));return `<article class="goal-card"><div class="card-head"><span class="badge">${esc(scopeLabel(g))}</span>${canEdit(g)?`<button data-delete="goals" data-id="${esc(g.id)}">×</button>`:''}</div><h3>${esc(g.name)}</h3><p>${money(g.current_amount)} de ${money(g.target_amount)}</p><progress class="progress-bar" max="100" value="${pct}">${pct}%</progress><p><b>${pct}% concluído</b>${g.target_date?` · até ${shortDate(g.target_date)}`:''}</p>${canEdit(g)?`<button class="btn btn-secondary" data-action="goal-contribution" data-id="${esc(g.id)}">Adicionar valor</button>`:''}</article>`}).join('')}</div>`:empty('Nenhuma meta ainda','Crie um objetivo para a casa ou para você.')}`;
}

function renderAgenda() {
  const year=state.calendarDate.getFullYear(),month=state.calendarDate.getMonth();
  const first=new Date(year,month,1), start=new Date(year,month,1-first.getDay());
  const events=scoped(state.data.events);let days='';
  for(let i=0;i<42;i++){const day=new Date(start);day.setDate(start.getDate()+i);const iso=localISO(day);const dayEvents=events.filter(e=>e.starts_at?.slice(0,10)===iso);days+=`<div class="calendar-day ${day.getMonth()!==month?'muted':''} ${iso===todayISO()?'today':''}"><span>${day.getDate()}</span>${dayEvents.slice(0,3).map(e=>`<span class="event-pill" title="${esc(e.title)}">${esc(e.title)}</span>`).join('')}</div>`}
  const upcoming=events.filter(e=>new Date(e.starts_at)>=new Date(Date.now()-86400000)).slice(0,8);
  return `<div class="page-heading"><div><h2>Agenda</h2><p>Compromissos pessoais e compartilhados em um só calendário.</p></div><button class="btn btn-primary" data-action="open-form" data-form="event">＋ Compromisso</button></div><div class="dashboard-grid"><article class="card wide-card"><div class="card-head"><button data-calendar="prev">‹</button><h3>${new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(first)}</h3><button data-calendar="next">›</button></div><div class="calendar-grid">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<b>${d}</b>`).join('')}${days}</div></article><article class="card wide-card"><div class="card-head"><h3>Próximos compromissos</h3></div>${upcoming.length?`<div class="list">${upcoming.map(eventRow).join('')}</div>`:empty('Nenhum compromisso','Sua agenda está livre.')}</article></div>`;
}
function localISO(date){const offset=date.getTimezoneOffset();return new Date(date.getTime()-offset*60000).toISOString().slice(0,10);}

function renderProfile() {
  const inviteParam=new URLSearchParams(location.search).get('invite');
  return `<div class="page-heading"><div><h2>Perfil e casa</h2><p>Gerencie sua identidade e quem participa desta casa.</p></div></div><div class="profile-layout"><article class="card"><div class="profile-avatar">${esc((state.profile?.display_name||'J')[0].toUpperCase())}</div><h3>${esc(state.profile?.display_name||'Usuário')}</h3><p>${esc(state.session.user.email)}</p><button class="btn btn-secondary" data-action="edit-profile">Editar nome</button></article><article class="card"><span class="badge">${state.membership.role==='owner'?'Proprietário':'Membro'}</span><h3>${esc(state.household.name)}</h3><p>${state.data.members.length} ${state.data.members.length===1?'pessoa':'pessoas'} nesta casa</p><div class="list">${state.data.members.map(m=>`<div class="list-row"><span class="list-icon">${esc((memberName(m.user_id)||'?')[0])}</span><div class="list-main"><b>${esc(memberName(m.user_id)||'Membro')}</b><small>${m.role==='owner'?'Proprietário':'Membro'}</small></div></div>`).join('')}</div></article>${state.membership.role==='owner'?`<article class="card"><h3>Convidar para a casa</h3><p>O convite só funciona para o e-mail indicado e expira em 7 dias.</p><form id="invite-form" class="form-stack"><label>E-mail da pessoa<input id="invite-email" type="email" required maxlength="254"></label><button class="btn btn-primary" type="submit">Gerar convite seguro</button></form><div id="invite-result"></div></article>`:''}<article class="card"><h3>Entrar por convite</h3><p>Cole o código recebido da pessoa responsável pela casa.</p><form id="accept-invite-form" class="form-stack"><label>Código do convite<input id="invite-token" value="${esc(uuidPattern.test(inviteParam||'')?inviteParam:'')}" required maxlength="36"></label><button class="btn btn-secondary" type="submit">Aceitar convite</button></form></article><article class="card wide-card"><h3>Segurança da conta</h3><p>Use uma senha exclusiva, não compartilhe códigos de acesso e saia da conta ao usar dispositivos de terceiros.</p><button class="btn btn-secondary" id="send-reset">Enviar redefinição de senha</button></article></div>`;
}

function renderOnboarding() {
  $('#view-title').textContent='Bem-vindo';
  $('#app-content').innerHTML=`<section class="onboarding"><span class="brand-mark">J<span>♥</span></span><h2>Vamos preparar sua casa</h2><p>Você pode começar uma nova organização ou entrar na casa de quem já usa o Juntos.</p><div class="onboarding-actions"><button class="choice-card" data-onboarding="create"><b>Criar uma casa</b><small>Comece agora e convide alguém depois.</small></button><button class="choice-card" data-onboarding="join"><b>Tenho um convite</b><small>Use o código enviado para você.</small></button></div><div id="onboarding-form"></div></section>`;
}

function openForm(type, context = {}) {
  const title = {transaction:'Nova movimentação',account:'Nova conta',card:'Novo cartão',task:'Nova tarefa',goal:'Nova meta',event:'Novo compromisso',budget:'Novo orçamento',recurring:'Nova recorrência',contribution:'Adicionar à meta',profile:'Editar perfil'}[type] || 'Adicionar';
  const categoryOptions = (kind='expense') => state.data.categories.filter(c=>c.kind===kind).map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  const accounts = scoped(state.data.accounts,'owner_user_id').map(a=>`<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
  const cards = scoped(state.data.cards,'owner_user_id').map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  const members = state.data.members.map(m=>`<option value="${esc(memberName(m.user_id)||'Membro')}">${esc(memberName(m.user_id)||'Membro')}</option>`).join('');
  const scopeField = `<label>Visibilidade<select name="scope"><option value="shared" ${state.scope==='shared'?'selected':''}>Casal</option><option value="personal" ${state.scope==='personal'?'selected':''}>Somente eu</option></select></label>`;
  let fields='';
  if(type==='transaction') fields=`<label>Tipo<select name="type" id="transaction-type"><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option></select></label>${scopeField}<label class="full-row">Descrição<input name="description" required maxlength="100" placeholder="Ex.: Mercado"></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required inputmode="decimal"></label><label>Data<input name="transaction_date" type="date" required value="${todayISO()}"></label><label>Categoria<select name="category_id" id="transaction-category"><option value="">Sem categoria</option>${categoryOptions()}</select></label><label>Conta<select name="account_id"><option value="">Selecione</option>${accounts}</select></label><label>Cartão<select name="credit_card_id"><option value="">Não usar cartão</option>${cards}</select></label><label class="full-row">Observação<textarea name="notes" maxlength="300" rows="2"></textarea></label>`;
  if(type==='account') fields=`<label class="full-row">Nome da conta<input name="name" required maxlength="60" placeholder="Ex.: Conta principal"></label><label>Tipo<select name="type"><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="cash">Dinheiro</option><option value="investment">Investimento</option><option value="other">Outra</option></select></label>${scopeField}<label>Saldo inicial<input name="initial_balance" type="number" step="0.01" value="0" required></label>`;
  if(type==='card') fields=`<label class="full-row">Nome do cartão<input name="name" required maxlength="60" placeholder="Ex.: Nubank"></label><label>Últimos 4 dígitos<input name="last_four" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="1234"></label>${scopeField}<label>Limite<input name="credit_limit" type="number" min="0" step="0.01"></label><label>Dia de fechamento<input name="closing_day" type="number" min="1" max="31" required></label><label>Dia de vencimento<input name="due_day" type="number" min="1" max="31" required></label>`;
  if(type==='task') fields=`<label class="full-row">Título<input name="title" required maxlength="100"></label>${scopeField}<label>Responsável<select name="assigned_to"><option value="">Sem responsável</option>${members}</select></label><label>Prazo<input name="due_date" type="date"></label><label>Prioridade<select name="priority"><option value="low">Baixa</option><option value="medium" selected>Média</option><option value="high">Alta</option></select></label><label>Recorrência<select name="recurrence"><option value="">Não repetir</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label><label class="full-row">Descrição<textarea name="description" maxlength="500" rows="3"></textarea></label>`;
  if(type==='goal') fields=`<label class="full-row">Nome da meta<input name="name" required maxlength="100" placeholder="Ex.: Reserva de emergência"></label>${scopeField}<label>Valor desejado<input name="target_amount" type="number" min="0.01" step="0.01" required></label><label>Já guardado<input name="current_amount" type="number" min="0" step="0.01" value="0"></label><label>Data-alvo<input name="target_date" type="date"></label>`;
  if(type==='event') fields=`<label class="full-row">Título<input name="title" required maxlength="100"></label>${scopeField}<label>Responsável<select name="responsible_user_id"><option value="">Sem responsável</option>${members}</select></label><label>Início<input name="starts_at" type="datetime-local" required></label><label>Término<input name="ends_at" type="datetime-local"></label><label>Local<input name="location" maxlength="120"></label><label class="full-row">Descrição<textarea name="description" maxlength="500" rows="3"></textarea></label>`;
  if(type==='budget') fields=`<label>Categoria<select name="category_id" required><option value="">Selecione</option>${categoryOptions('expense')}</select></label>${scopeField}<label>Mês<input name="month" type="month" required value="${todayISO().slice(0,7)}"></label><label>Limite<input name="amount" type="number" min="0.01" step="0.01" required></label>`;
  if(type==='recurring') fields=`<label>Tipo<select name="type"><option value="expense">Despesa fixa</option><option value="income">Receita recorrente</option></select></label>${scopeField}<label class="full-row">Descrição<input name="description" required maxlength="100"></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Próxima data<input name="next_date" type="date" value="${todayISO()}" required></label><label>Frequência<select name="frequency"><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly" selected>Mensal</option><option value="yearly">Anual</option></select></label><label>Categoria<select name="category_id"><option value="">Sem categoria</option>${categoryOptions()}</select></label><label>Conta<select name="account_id"><option value="">Sem conta</option>${accounts}</select></label><label>Cartão<select name="credit_card_id"><option value="">Sem cartão</option>${cards}</select></label>`;
  if(type==='contribution') fields=`<input type="hidden" name="goal_id" value="${esc(context.id)}"><label class="full-row">Valor a adicionar<input name="amount" type="number" min="0.01" step="0.01" required></label>`;
  if(type==='profile') fields=`<label class="full-row">Seu nome<input name="display_name" required minlength="2" maxlength="60" value="${esc(state.profile?.display_name||'')}"></label>`;
  $('#dynamic-form').innerHTML=`<h2 id="form-title">${title}</h2><form id="entity-form" class="form-grid" data-entity="${type}">${fields}<div class="form-actions"><button type="button" class="btn btn-ghost" data-close-form>Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div><p class="form-message full-row" id="entity-message"></p></form>`;
  $('#form-modal').hidden=false;
  setTimeout(()=>$('#entity-form input:not([type=hidden])')?.focus(),30);
}

async function submitEntity(form) {
  const button=$('button[type=submit]',form);setBusy(button,true,'Salvando…');
  try {
    const type=form.dataset.entity;const raw=Object.fromEntries(new FormData(form));
    Object.keys(raw).forEach(key=>{if(raw[key]==='')raw[key]=null});
    let table,payload;const owner_uid=state.session.user.id;const scope=raw.scope||state.scope;
    if(type==='transaction'){table='transactions';payload={type:raw.type==='income'?'Receita':raw.type==='transfer'?'Transferência':'Despesa',description:raw.description,amount:Number(raw.amount),category:raw.category_id||'',account:raw.account_id||'',card:raw.credit_card_id||'',date:brDate(raw.transaction_date),variable:0,recurring:0,installments:1,notes:raw.notes||'',payment_status:'paid',due_date:brDate(raw.transaction_date),paid_date:brDate(raw.transaction_date),paid_amount:Number(raw.amount),recurring_key:'',recurring_period:'',owner_uid,scope};}
    if(type==='account'){table='accounts';payload={name:raw.name,type:accountType(raw.type),balance:Number(raw.initial_balance||0),active:1,owner_uid,scope};}
    if(type==='card'){table='cards';payload={name:raw.name,last_four:raw.last_four||'',credit_limit:Number(raw.credit_limit||0),closing_day:Number(raw.closing_day),due_day:Number(raw.due_day),active:1,owner_uid,scope};}
    if(type==='task'){table='tasks';payload={title:raw.title,responsible:raw.assigned_to||'',due:brDate(raw.due_date),time:'',priority:raw.priority==='high'?'alta':raw.priority==='low'?'baixa':'media',recurrence:raw.recurrence||'',status:'Pendente',completed_at:'',description:raw.description||'',owner_uid,scope};}
    if(type==='goal'){table='goals';payload={name:raw.name,target:Number(raw.target_amount),current:Number(raw.current_amount||0),target_date:brDate(raw.target_date),done:0,owner_uid,scope};}
    if(type==='event'){table='events';const start=new Date(raw.starts_at);payload={title:raw.title,date:brDate(localISO(start)),time:String(raw.starts_at).slice(11,16),location:raw.location||'',responsible:raw.responsible_user_id||'',recurrence:'',reminder:'',notes:raw.description||'',owner_uid,scope};}
    if(type==='budget'){table='budgets';payload={category:raw.category_id||'',month:raw.month,amount:Number(raw.amount),owner_uid,scope};}
    if(type==='recurring'){table='recurring_expenses';payload={description:raw.description,amount:Number(raw.amount),category:raw.category_id||'Outros',account:raw.account_id||'',due_day:Number(String(raw.next_date).slice(8,10)),frequency:frequency(raw.frequency),start_date:brDate(raw.next_date),last_paid_period:'',notes:'',active:1,owner_uid,scope};}
    if(type==='contribution'){const goal=state.data.goals.find(g=>g.id===raw.goal_id);if(!goal)throw new Error('Meta não encontrada');const next={...goal._payload,current:Number(goal.current_amount||0)+Number(raw.amount)};await updateSyncRecord(goal,next);hideForm();toast('Valor adicionado à meta.');await refreshData();return;}
    if(type==='profile'){const {error}=await supabase.from('profiles').update({display_name:raw.display_name.trim()}).eq('id',state.session.user.id);if(error)throw error;state.profile.display_name=raw.display_name.trim();updateIdentity();hideForm();renderCurrentView();toast('Perfil atualizado.');return;}
    if(!table)throw new Error('Formulário inválido');
    const {error}=await supabase.from('juntos_sync_records').insert({household_id:state.household.id,record_id:crypto.randomUUID(),table_name:table,payload,deleted:false,updated_by:owner_uid});if(error)throw error;
    hideForm();toast('Salvo com segurança.');await refreshData();
  } catch(error){$('#entity-message').textContent=friendlyError(error);console.error(error);} finally {setBusy(button,false);}
}
function pick(source,keys){return Object.fromEntries(keys.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));}

async function deleteEntity(table,id) {
  if(!uuidPattern.test(id))return;
  const labels={transactions:'esta movimentação',accounts:'esta conta',credit_cards:'este cartão',goals:'esta meta',budgets:'este orçamento',calendar_events:'este compromisso'};
  if(!confirm(`Deseja realmente remover ${labels[table]||'este registro'}?`))return;
  try {
    const syncTable=({credit_cards:'cards',calendar_events:'events',recurring_items:'recurring_expenses'})[table]||table;
    const {error}=await supabase.from('juntos_sync_records').update({payload:{},deleted:true,updated_by:state.session.user.id}).eq('household_id',state.household.id).eq('table_name',syncTable).eq('record_id',id);if(error)throw error;toast('Registro removido.');await refreshData();
  } catch(error){toast(friendlyError(error),'error');}
}

async function completeTask(id) {
  const task=state.data.tasks.find(item=>item.id===id);if(!task)return;
  const done=task.status==='done';
  try{await updateSyncRecord(task,{...task._payload,status:done?'Pendente':'Concluída',completed_at:done?'':new Date().toISOString()});await refreshData();}catch(error){toast(friendlyError(error),'error');}
}

async function updateSyncRecord(item,payload){
  const {error}=await supabase.from('juntos_sync_records').update({payload,deleted:false,updated_by:state.session.user.id}).eq('household_id',state.household.id).eq('table_name',item._syncTable).eq('record_id',item.id);
  if(error)throw error;
}

async function createHousehold(name) {
  const {error}=await supabase.rpc('create_household',{p_name:name});if(error)throw error;await handleSession(state.session);toast('Sua casa foi criada.');
}
async function acceptInvite(token) {
  if(!uuidPattern.test(token))throw new Error('Código inválido');
  const {error}=await supabase.rpc('accept_household_invite',{p_token:token});if(error)throw error;
  history.replaceState({},'',location.pathname);await handleSession(state.session);toast('Você entrou na casa compartilhada.');
}

document.addEventListener('click',async event=>{
  const open=event.target.closest('[data-open-auth]');if(open){showAuth(open.dataset.openAuth);return;}
  if(event.target.closest('[data-close-modal]')){hideAuth();return;}
  if(event.target.closest('[data-close-form]')){hideForm();return;}
  const tab=event.target.closest('[data-auth-tab]');if(tab){switchAuthTab(tab.dataset.authTab);return;}
  const view=event.target.closest('[data-view]');if(view&&state.session){state.view=view.dataset.view;$('.sidebar')?.classList.remove('open');renderCurrentView();return;}
  const scope=event.target.closest('[data-scope]');if(scope){state.scope=scope.dataset.scope;renderCurrentView();return;}
  const finance=event.target.closest('[data-finance-tab]');if(finance){state.financeTab=finance.dataset.financeTab;renderFinanceIntoPage();return;}
  const form=event.target.closest('[data-action="open-form"]');if(form){openForm(form.dataset.form);return;}
  const del=event.target.closest('[data-delete]');if(del){await deleteEntity(del.dataset.delete,del.dataset.id);return;}
  const complete=event.target.closest('[data-complete-task]');if(complete){await completeTask(complete.dataset.completeTask);return;}
  const cal=event.target.closest('[data-calendar]');if(cal){state.calendarDate.setMonth(state.calendarDate.getMonth()+(cal.dataset.calendar==='next'?1:-1));renderCurrentView();return;}
  const contrib=event.target.closest('[data-action="goal-contribution"]');if(contrib){openForm('contribution',{id:contrib.dataset.id});return;}
  if(event.target.closest('[data-action="edit-profile"]')){openForm('profile');return;}
  if(event.target.closest('[data-action="reload"]')){await refreshData();return;}
  const onboarding=event.target.closest('[data-onboarding]');if(onboarding){renderOnboardingChoice(onboarding.dataset.onboarding);return;}
});

function renderFinanceIntoPage(){state.view='financas';renderCurrentView();}
function renderOnboardingChoice(choice){$('#onboarding-form').innerHTML=choice==='create'?`<form id="create-house-form" class="form-stack"><label>Nome da casa<input id="house-name" value="Nossa casa" required maxlength="60"></label><button class="btn btn-primary" type="submit">Criar e continuar</button></form>`:`<form id="join-house-form" class="form-stack"><label>Código do convite<input id="join-token" required maxlength="36"></label><button class="btn btn-primary" type="submit">Entrar na casa</button></form>`;}

document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;
  if(form.id==='login-form'){const btn=$('button[type=submit]',form);setBusy(btn,true);const {error}=await supabase.auth.signInWithPassword({email:$('#login-email').value.trim(),password:$('#login-password').value});setBusy(btn,false);if(error)$('#auth-message').textContent=friendlyError(error);}
  if(form.id==='signup-form'){const btn=$('button[type=submit]',form);setBusy(btn,true);const name=$('#signup-name').value.trim(),password=$('#signup-password').value;if(!/(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(password)){setBusy(btn,false);$('#auth-message').textContent='Inclua letras, número e símbolo na senha.';return;}const {data,error}=await supabase.auth.signUp({email:$('#signup-email').value.trim(),password,options:{data:{display_name:name},emailRedirectTo:SITE_URL}});setBusy(btn,false);if(error)$('#auth-message').textContent=friendlyError(error);else{const msg=$('#auth-message');msg.textContent=data.session?'Conta criada. Preparando sua casa…':'Conta criada! Confira seu e-mail para confirmar o acesso.';msg.className='form-message success';}}
  if(form.id==='reset-form'){const btn=$('button[type=submit]',form);setBusy(btn,true);const {error}=await supabase.auth.updateUser({password:$('#reset-password').value});setBusy(btn,false);if(error)$('#auth-message').textContent=friendlyError(error);else{toast('Senha atualizada.');hideAuth();}}
  if(form.id==='entity-form')await submitEntity(form);
  if(form.id==='create-house-form'){const btn=$('button[type=submit]',form);setBusy(btn,true);try{await createHousehold($('#house-name').value.trim());}catch(error){toast(friendlyError(error),'error');}finally{setBusy(btn,false);}}
  if(form.id==='join-house-form'){const btn=$('button[type=submit]',form);setBusy(btn,true);try{await acceptInvite($('#join-token').value.trim());}catch(error){toast(friendlyError(error),'error');}finally{setBusy(btn,false);}}
  if(form.id==='invite-form'){const btn=$('button[type=submit]',form);setBusy(btn,true);try{const email=$('#invite-email').value.trim();const {data,error}=await supabase.rpc('create_household_invite',{p_household_id:state.household.id,p_email:email});if(error)throw error;const link=`${SITE_URL}?invite=${data}`;$('#invite-result').innerHTML=`<p class="invite-box">${esc(link)}</p><button class="btn btn-secondary" type="button" data-copy="${esc(link)}">Copiar convite</button>`;toast('Convite criado.');}catch(error){toast(friendlyError(error),'error');}finally{setBusy(btn,false);}}
  if(form.id==='accept-invite-form'){const btn=$('button[type=submit]',form);setBusy(btn,true);try{await acceptInvite($('#invite-token').value.trim());}catch(error){toast(friendlyError(error),'error');}finally{setBusy(btn,false);}}
});

document.addEventListener('click',async event=>{const copy=event.target.closest('[data-copy]');if(copy){await navigator.clipboard.writeText(copy.dataset.copy);toast('Convite copiado.');}});
$('#forgot-password').addEventListener('click',async()=>{const email=$('#login-email').value.trim();if(!email){$('#auth-message').textContent='Digite seu e-mail primeiro.';return;}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:SITE_URL});if(error)$('#auth-message').textContent=friendlyError(error);else{$('#auth-message').textContent='Enviamos as instruções para seu e-mail.';$('#auth-message').className='form-message success';}});
$('#logout-button').addEventListener('click',async()=>{await supabase.auth.signOut();state.session=null;state.profile=null;state.membership=null;state.household=null;});
$('#quick-add').addEventListener('click',()=>openForm(state.view==='tarefas'?'task':state.view==='agenda'?'event':state.view==='metas'?'goal':'transaction'));
$('#mobile-menu').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
document.addEventListener('click',async event=>{if(event.target.id==='send-reset'){const {error}=await supabase.auth.resetPasswordForEmail(state.session.user.email,{redirectTo:SITE_URL});toast(error?friendlyError(error):'E-mail de redefinição enviado.',error?'error':'');}});
document.addEventListener('change',event=>{if(event.target.id==='transaction-type'){const select=$('#transaction-category');const kind=event.target.value==='income'?'income':'expense';select.innerHTML=`<option value="">Sem categoria</option>${state.data.categories.filter(c=>c.kind===kind).map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}`;}});

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
authenticate();
