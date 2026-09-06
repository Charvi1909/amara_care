import {
  loadUsers,
  getTasks,
  createTask,
  updateTask,
  subscribeToTasks,
  suggestAssignee,
  todayISO,
  toISODate,
  isInPast,
  formatTime,
  initFamilyContext,
  getFamily,
  removeFamilyMember,
  getDependents,
  addDependent,
  removeDependent,
  signOut,
  getUserId,
  subscribeToFamilyActivity,
  requestHandoff,
  getIncomingHandoffs,
  acceptHandoff,
  declineHandoff,
  createProposal,
  getOpenProposals,
  cancelProposal,
  voteProposal,
  windowToDate,
  updateFamily,
  findEmergencyTasks,
  promoteUncoveredImminent,
  escalateEmergency,
  proposeEscalation,
  closeStaleEscalations,
  markEmergencyFinal,
  deadlineImminent,
  FINAL_TIER_SEC,
  findConflict,
  claimTask
} from './api.js';

// Reference numbers shown at the highest-urgency tier. Display only — nothing
// is dialled or messaged. (India national services.)
const EMERGENCY_NUMBERS = [
  ['112', 'National emergency (police / fire / ambulance)'],
  ['108', 'Ambulance'],
  ['14567', 'Elderline — senior citizens helpline'],
  ['1098', 'Childline'],
];

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    role: 'caregiver',
    activeFilters: { caregiver: 'all', category: 'all' },
    currentWeek: 0,
    selectedDate: null,
    tasks: [],
    stagedTasks: [],
    me: null,       // logged-in user's public.users row
    family: null,   // { id, name, invite_code }
    dependents: [], // [{ id, name, relation }] — people the family cares for
    caregivers: [],
    proposals: [],       // open delete/reschedule votes
    incomingHandoffs: [] // handoff requests waiting on me
  };

  const safeRun = (name, fn) => {
    try { fn(); }
    catch(e) { console.warn(`Skipping ${name} setup:`, e); }
  };

  // Display-only: names are stored however the user typed them at signup
  // ("manyademo", "charvi"). Title-case them for rendering so they read
  // consistently with the Care Circle initials. NEVER use this for comparisons,
  // <option> values, or anything sent to the API — those keep the raw value.
  const displayName = (name) => {
    const s = String(name == null ? '' : name).trim();
    if (!s) return 'Unassigned';
    return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  };
  
  safeRun('Logo Reset', setupLogoReset);
  safeRun('Tabs', setupTabs);
  safeRun('Role Switcher', setupRoleSwitcher);
  safeRun('Dropdowns', setupDropdowns);
  safeRun('Modals', setupModals);
  safeRun('Filters', setupFilters);
  safeRun('Chaos Engine', setupChaosEngine);
  safeRun('Chat AI', setupChat);
  safeRun('Done Toggle', setupDoneToggle);
  safeRun('Calendar Arrows', setupCalendarArrows);
  safeRun('Manual Add Task', setupAddTask);

  let _refreshTimer = null;
  let _decisionTimer = null;
  initData(); // auth gate + first render happen here

  async function initData() {
    // Auth + family gate. No session / no family -> login page.
    let ctx;
    try {
      ctx = await initFamilyContext();
    } catch (err) {
      console.error('Auth check failed:', err);
    }
    if (!ctx) {
      window.location.replace('login.html');
      return;
    }
    state.me = ctx.profile;

    try {
      state.family = await getFamily();
      state.dependents = await getDependents();

      const users = await loadUsers();
      rebuildCaregivers(users);

      applyIdentity();
      await refreshTasks();
      await refreshDecisions();
      subscribeToTasks(() => {
        clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(() => { refreshTasks(); refreshDecisions(); }, 200);
      });
      subscribeToFamilyActivity(() => {
        clearTimeout(_decisionTimer);
        _decisionTimer = setTimeout(() => { refreshDecisions(); refreshTasks(); }, 250);
      });
      // periodic catch-up: realtime lag, ack status, and tasks crossing into
      // the 60-min escalation window over time.
      setInterval(() => {
        refreshDecisions();
        const needsCheck = state.tasks.some(t =>
          (t._status === 'uncovered_urgent' && (!t._emergencyAlertedAt || !t._emergencyAckedAt)) ||
          // an unassigned task that may have just crossed into the 60-min window
          (!t._assignedTo && t._status !== 'uncovered_urgent' && t._status !== 'completed' &&
           t.status !== 'done' && !t._emergencyAlertedAt &&
           deadlineImminent(t._date, t._time, t.priority))
        );
        if (needsCheck) { refreshTasksQuiet().then(checkEmergencies); }
      }, 12000);
      setupCoverAndPropose();
    } catch (err) {
      console.error('Backend init failed:', err);
      showToast('Could not reach the server — working offline.');
      renderAll();
    }
  }

  // Reflect the logged-in user + family in the header / profile modal.
  function applyIdentity() {
    const firstName = (state.me && state.me.name ? displayName(state.me.name.split(' ')[0]) : 'there');
    const greetingName = document.getElementById('greetingName');
    if (greetingName) greetingName.innerText = `Hello, ${firstName}`;
    const profileName = document.getElementById('profileName');
    if (profileName && state.me) profileName.innerText = displayName(state.me.name);

    const dependentNames = (state.dependents || []).map(d => displayName(d.name));
    const ctxLine = document.getElementById('greetingContext');
    if (ctxLine && state.family) {
      ctxLine.innerText = dependentNames.length
        ? `Caring for ${dependentNames.join(', ')} · ${state.family.name}`
        : `Coordinating care · ${state.family.name}`;
    }
    const emName = document.getElementById('emergencyDependentName');
    if (emName) emName.innerText = dependentNames.length ? dependentNames.join(', ') : '—';
  }

  async function refreshTasks() {
    const { data, error } = await getTasks();
    if (!error && data) state.tasks = data;
    renderAll();
    checkEmergencies();
  }

  const _emergencyShown = new Set();

  // A task can't be covered and is at its escalation point:
  //  - has a specific time (or overdue) -> no time for a vote, email now
  //  - timeless "any time today" (high priority) -> raise a family vote first
  async function checkEmergencies() {
    try { await closeStaleEscalations(state.tasks); } catch (e) { /* non-fatal */ }

    // Flag tasks that quietly hit their deadline with no owner and no handoff,
    // so an untouched task can't just silently expire.
    try {
      const { promoted } = await promoteUncoveredImminent(state.tasks);
      if (promoted.length) await refreshTasksQuiet();
    } catch (e) { /* non-fatal */ }

    let candidates = [];
    try { candidates = await findEmergencyTasks(state.tasks); } catch (e) { return; }
    if (candidates.length === 0) return;

    const timed = candidates.filter(t => !!t._time);
    const timeless = candidates.filter(t => !t._time);
    let changed = false;

    for (const t of timed) {
      const r = await escalateEmergency(t.id);
      changed = true;
      if (r && r.alerted && !r.alreadyAlerted && !_emergencyShown.has(t.id)) {
        _emergencyShown.add(t.id);
        showEmergencyModal(t, r);
      }
    }

    for (const t of timeless) {
      const r = await proposeEscalation(t.id);
      if (r && !r.error && !r.existed) changed = true;
    }

    if (changed) { await refreshDecisions(); await refreshTasksQuiet(); }
  }

  async function refreshTasksQuiet() {
    const { data, error } = await getTasks();
    if (!error && data) state.tasks = data;
    renderAll();
  }

  function showEmergencyModal(task, result) {
    const overlay = document.getElementById('emergencyAlertOverlay');
    const body = document.getElementById('emergencyAlertBody');
    const emailLine = document.getElementById('emergencyAlertEmail');
    if (!overlay) return;
    const contactName = (result.contact && result.contact.name) || 'your emergency contact';
    if (body) {
      body.innerHTML =
        `<strong>${task.title}</strong> (${formatDateLabel(task.date)}${task.time ? ' · ' + task.time : ''}) ` +
        `is uncovered — no one in the family claimed it and its deadline is here. ` +
        `<strong>${contactName}</strong> has been notified to help coordinate.`;
    }
    if (emailLine) {
      const parts = [];
      parts.push(result.emailSent
        ? `Email sent to ${result.contact.info}.`
        : `Email to contact not sent${result.emailError ? ` (${result.emailError})` : ''} — in-app alert still logged.`);
      if (result.membersNotified) parts.push(`${result.membersNotified} family member${result.membersNotified > 1 ? 's' : ''} also emailed.`);
      emailLine.textContent = parts.join(' ');
    }
    overlay.removeAttribute('hidden');
  }

  async function refreshDecisions() {
    state.proposals = await getOpenProposals();
    state.incomingHandoffs = await getIncomingHandoffs();
    renderDecisions();
  }

  // The "Family Decisions" banner — pending handoff requests + open votes.
  function renderDecisions() {
    const banner = document.getElementById('decisionsBanner');
    const listEl = document.getElementById('decisionsList');
    const countEl = document.getElementById('decisionsCount');
    if (!banner || !listEl) return;

    const myId = getUserId();
    const taskById = Object.fromEntries(state.tasks.map(t => [t.id, t]));
    const nameById = Object.fromEntries(state.caregivers.map(c => [c.id, c.name]));
    const memberCount = votingMembers().length || 1;   // logged-in members only
    const majority = Math.floor(memberCount / 2) + 1;   // strict majority

    const cards = [];

    state.incomingHandoffs.forEach(h => {
      const task = taskById[h.task_id];
      const who = nameById[h.requested_by] ? displayName(nameById[h.requested_by]) : 'A family member';
      cards.push(`
        <div class="decision-item" data-handoff="${h.id}" data-task="${h.task_id}">
          <p><strong>${who}</strong> can't cover <strong>${task ? task.title : 'a task'}</strong>${task ? ` (${formatDateLabel(task.date)})` : ''}.</p>
          <p class="sub">Can you take it on?</p>
          <div class="decision-actions">
            <button class="vote-yes" data-act="accept">Yes, I'll cover it</button>
            <button class="vote-no" data-act="decline">Can't either</button>
          </div>
        </div>`);
    });

    state.proposals.forEach(p => {
      const task = taskById[p.task_id];
      const proposer = nameById[p.proposed_by] ? displayName(nameById[p.proposed_by]) : 'Someone';
      const votes = p.votes || {};
      const yes = Object.values(votes).filter(v => v === 'approve').length;
      const no = Object.values(votes).filter(v => v === 'reject').length;
      const myVote = votes[myId];
      const isMine = p.proposed_by === myId;
      const tname = task ? task.title : 'a task';
      let line;
      if (p.kind === 'escalate') {
        line = `<strong>Nobody could cover "${tname}"</strong> and it's due today with no set time. Alert the family's emergency contact?`;
      } else if (p.kind === 'delete') {
        line = `<strong>${proposer}</strong> wants to delete <strong>${tname}</strong>.`;
      } else if (p.new_date) {
        line = `<strong>${proposer}</strong> wants to move <strong>${tname}</strong> to ${formatDateLabel(p.new_date)}.`;
      } else {
        line = `<strong>${proposer}</strong> wants to move <strong>${tname}</strong> to anytime ${String(p.new_window || '').replace('_', ' ')}.`;
      }

      cards.push(`
        <div class="decision-item ${p.kind === 'escalate' ? 'escalate' : ''}" data-proposal="${p.id}">
          <p>${line}</p>
          <p class="sub">${yes} of ${memberCount} approve · needs ${majority}${no ? ` · ${no} against` : ''}</p>
          <div class="decision-actions">
            <button class="vote-yes" data-act="approve" ${myVote ? 'disabled' : ''}>${myVote === 'approve' ? 'You approved' : (p.kind === 'escalate' ? 'Yes, alert them' : 'Approve')}</button>
            <button class="vote-no" data-act="reject" ${myVote ? 'disabled' : ''}>${myVote === 'reject' ? 'You rejected' : (p.kind === 'escalate' ? 'Not yet' : 'Reject')}</button>
            ${isMine && p.kind !== 'escalate' ? '<button class="vote-neutral" data-act="cancel">Withdraw</button>' : ''}
          </div>
        </div>`);
    });

    if (cards.length === 0) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    countEl.textContent = cards.length;
    listEl.innerHTML = cards.join('');
  }

  function ackSecondsLeft(t) {
    if (!t._emergencyAlertedAt || t._emergencyAckedAt || t._emergencyFinalAt) return null;
    // server writes UTC; tolerate a timestamp that came back without a tz
    let iso = String(t._emergencyAlertedAt);
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) iso += 'Z';
    const elapsed = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(elapsed)) return null;
    return Math.max(0, Math.ceil(FINAL_TIER_SEC - elapsed));
  }

  const numbersBlock = () => `
    <div class="emergency-numbers">
      <p class="emergency-services-msg">No response yet. <strong>If this is a medical emergency, contact emergency services directly.</strong></p>
      <ul>${EMERGENCY_NUMBERS.map(([n, d]) => `<li><span class="num">${n}</span> ${d}</li>`).join('')}</ul>
      <p class="ref-note">Reference only — Amara does not contact these numbers for you.</p>
    </div>`;

  function renderUrgentZone() {
    const tasks = state.tasks.filter(t => t._status === 'uncovered_urgent');
    const html = tasks.map(t => {
      const acked = !!t._emergencyAckedAt;
      const alerted = !!t._emergencyAlertedAt;
      const final = !!t._emergencyFinalAt;
      const timed = !!t._time;
      const atPoint = deadlineImminent(t._date, t._time, t.priority);
      const secs = ackSecondsLeft(t);

      let tag = '';
      if (acked) tag = `<span class="urgent-alerted-tag acked">Emergency contact acknowledged — help is on the way</span>`;
      else if (final) tag = `<span class="urgent-alerted-tag final">Emergency contact did not respond</span>`;
      else if (alerted) tag = `<span class="urgent-alerted-tag">Emergency contact notified</span>` +
        (secs != null ? `<span class="ack-countdown" data-cd="${t.id}">waiting for response — <strong>0:${String(secs).padStart(2, '0')}</strong></span>` : '');
      else if (!atPoint) tag = `<span class="urgent-alerted-tag pending">${timed ? 'Emergency contact alerted automatically ~1h before deadline' : 'Emergency contact alerted if still uncovered today'}</span>`;
      else if (timed) tag = `<span class="urgent-alerted-tag">Alerting emergency contact…</span>`;
      else tag = `<span class="urgent-alerted-tag pending">Family vote: alert the emergency contact?</span>`;

      return `
      <div class="urgent-item ${acked ? 'acked' : (final ? 'final' : '')}" data-id="${t.id}">
        <strong>${t.title}</strong>
        <div class="sub">${formatDateLabel(t.date)}${t.time ? ' · ' + t.time : ''} — no one could cover this${t.dependent ? ` · for ${displayName(t.dependent)}` : ''}</div>
        ${tag}
        ${final && !acked ? numbersBlock() : ''}
        <div class="urgent-actions">
          <button class="btn-claim" data-id="${t.id}">I'll take it</button>
          <button class="btn-propose" data-id="${t.id}">⚑ Propose reschedule</button>
        </div>
      </div>`;
    }).join('');

    const allAcked = tasks.length > 0 && tasks.every(t => t._emergencyAckedAt);
    const anyFinal = tasks.some(t => t._emergencyFinalAt && !t._emergencyAckedAt);

    [['urgentZoneHome', 'urgentListHome'], ['urgentZoneSchedule', 'urgentListSchedule']].forEach(([zoneId, listId]) => {
      const zone = document.getElementById(zoneId);
      const list = document.getElementById(listId);
      if (!zone || !list) return;
      zone.hidden = tasks.length === 0;
      zone.classList.toggle('calm', allAcked && !anyFinal);
      zone.classList.toggle('critical', anyFinal);
      const head = zone.querySelector('.urgent-head h2');
      if (head) head.textContent = anyFinal ? 'No Response — Escalate Externally'
        : allAcked ? 'Help Is On The Way' : 'Needs Urgent Coverage';
      list.innerHTML = html;
    });
  }

  // 1-second ticker: updates the ack countdown and flips to the final tier.
  setInterval(async () => {
    const items = state.tasks.filter(t => ackSecondsLeft(t) != null);
    if (items.length === 0) return;
    let flipped = false;
    for (const t of items) {
      const s = ackSecondsLeft(t);
      if (s <= 0) {
        try { const r = await markEmergencyFinal(t.id); if (r.escalated) flipped = true; } catch (e) {}
      } else {
        document.querySelectorAll(`.ack-countdown[data-cd="${t.id}"] strong`)
          .forEach(el => { el.textContent = `0:${String(s).padStart(2, '0')}`; });
      }
    }
    if (flipped) { await refreshTasksQuiet(); }
  }, 1000);

  // Delegated handler for the urgent-zone buttons (both copies).
  ['urgentListHome', 'urgentListSchedule'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async (e) => {
      const claimBtn = e.target.closest('.btn-claim');
      const propBtn = e.target.closest('.btn-propose');
      if (claimBtn) {
        await claimTaskFlow(claimBtn.getAttribute('data-id'));
      } else if (propBtn) {
        openProposeModal(propBtn.getAttribute('data-id'));
      }
    });
  });

  document.getElementById('emergencyAlertClose')?.addEventListener('click', () => {
    document.getElementById('emergencyAlertOverlay')?.setAttribute('hidden', 'true');
  });

  document.getElementById('decisionsList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const item = btn.closest('.decision-item');
    btn.disabled = true;

    if (item.dataset.handoff) {
      const hid = item.dataset.handoff, tid = item.dataset.task;
      if (act === 'accept') {
        const me = getCurrentUser();
        const htask = state.tasks.find(x => x.id === tid);
        const conflict = htask && findConflict(me, htask._date, htask._time, state.tasks, tid);
        if (conflict && !confirm(
          `Heads up: this overlaps with "${conflict.title}" at ${formatDateLabel(conflict.date)} ${conflict.time}, which is already yours.\n\nAccept anyway?`
        )) {
          btn.disabled = false;
          return;
        }
        const { error } = await acceptHandoff(hid, tid);
        showToast(error ? 'Could not accept: ' + error.message
          : conflict ? `Accepted — you now have two things at ${conflict.time}.` : 'You’re covering it now.');
      } else {
        const { error, everyoneDeclined } = await declineHandoff(hid, tid);
        showToast(error ? 'Could not decline: ' + error.message
          : everyoneDeclined ? 'Everyone declined — task is now unassigned.' : 'Declined.');
      }
    } else if (item.dataset.proposal) {
      const pid = item.dataset.proposal;
      if (act === 'cancel') {
        const { error } = await cancelProposal(pid);
        showToast(error ? 'Could not withdraw: ' + error.message : 'Proposal withdrawn.');
      } else {
        const prop = state.proposals.find(x => x.id === pid);
        const { error, status, escalation, rescheduleConflict } = await voteProposal(pid, act === 'approve' ? 'approve' : 'reject');
        if (error) showToast('Vote failed: ' + error.message);
        else if (status === 'approved' && escalation) {
          const task = prop && state.tasks.find(x => x.id === prop.task_id);
          showEmergencyModal(task || { title: 'the task', date: todayISO() }, escalation);
          showToast('Emergency contact notified.');
        }
        else if (status === 'approved' && rescheduleConflict) {
          showToast(`Rescheduled — but ${rescheduleConflict.who} now has this AND "${rescheduleConflict.title}" at ${rescheduleConflict.time}. Someone should sort it out.`);
        }
        else showToast(status === 'approved' ? 'Approved by the family — done.'
          : status === 'rejected' ? 'The family decided not to.' : 'Vote recorded.');
      }
    }
    await refreshDecisions();
    await refreshTasks();
  });

  let coverTaskId = null;
  let proposeTaskId = null;
  let proposeWindow = null;

  function setupCoverAndPropose() {
    const cover = document.getElementById('coverActionOverlay');
    const propose = document.getElementById('proposeOverlay');
    const hide = (el) => el && el.setAttribute('hidden', 'true');

    document.getElementById('coverCloseBtn')?.addEventListener('click', () => hide(cover));
    document.getElementById('proposeCloseBtn')?.addEventListener('click', () => hide(propose));

    document.getElementById('justDropBtn')?.addEventListener('click', async () => {
      hide(cover);
      if (!coverTaskId) return;
      const { error } = await updateTask(coverTaskId, { assignee: 'Unassigned', status: 'pending' });
      showToast(error ? 'Failed: ' + error.message : 'Task marked unassigned.');
      await refreshTasks();
    });

    document.getElementById('askFamilyBtn')?.addEventListener('click', async () => {
      hide(cover);
      if (!coverTaskId) return;
      const { error } = await requestHandoff(coverTaskId);
      showToast(error ? error.message : 'Sent to the family — someone can pick it up.');
      await refreshTasks();
      await refreshDecisions();
    });

    document.getElementById('proposeRescheduleBtn')?.addEventListener('click', () => {
      hide(cover);
      openProposeModal(coverTaskId);
    });

    document.querySelectorAll('input[name="propKind"]').forEach(r => r.addEventListener('change', () => {
      const isReschedule = document.querySelector('input[name="propKind"]:checked').value === 'reschedule';
      document.getElementById('rescheduleFields').hidden = !isReschedule;
    }));

    document.getElementById('propWindows')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-win]');
      if (!b) return;
      document.querySelectorAll('#propWindows button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      proposeWindow = b.getAttribute('data-win');
      const di = document.getElementById('propDate');
      if (di) di.value = '';
    });
    document.getElementById('propDate')?.addEventListener('input', () => {
      proposeWindow = null;
      document.querySelectorAll('#propWindows button').forEach(x => x.classList.remove('active'));
    });

    document.getElementById('submitProposalBtn')?.addEventListener('click', async () => {
      const errEl = document.getElementById('proposeError');
      errEl.hidden = true;
      const kind = document.querySelector('input[name="propKind"]:checked').value;
      const specificDate = document.getElementById('propDate')?.value || null;

      if (kind === 'reschedule' && !specificDate && !proposeWindow) {
        errEl.textContent = 'Pick a date or a time window.'; errEl.hidden = false; return;
      }
      const { error } = await createProposal({
        taskId: proposeTaskId, kind,
        newDate: kind === 'reschedule' ? specificDate : null,
        newWindow: kind === 'reschedule' ? (specificDate ? null : proposeWindow) : null,
      });
      if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
      hide(propose);
      showToast('Proposal sent to the family vote.');
      await refreshDecisions();
    });
  }

  function openCoverModal(taskId) {
    coverTaskId = taskId;
    const t = state.tasks.find(x => x.id === taskId);
    const label = document.getElementById('coverTaskLabel');
    if (label) label.textContent = t ? `"${t.title}" — ${formatDateLabel(t.date)}` : '';
    document.getElementById('coverActionOverlay')?.removeAttribute('hidden');
  }

  function openProposeModal(taskId) {
    proposeTaskId = taskId;
    proposeWindow = null;
    const t = state.tasks.find(x => x.id === taskId);
    const label = document.getElementById('proposeTaskLabel');
    if (label) label.textContent = t ? `"${t.title}" — currently ${formatDateLabel(t.date)}` : '';
    const di = document.getElementById('propDate');
    if (di) { di.value = ''; di.min = todayISO(); }
    document.querySelectorAll('#propWindows button').forEach(x => x.classList.remove('active'));
    const firstRadio = document.querySelector('input[name="propKind"][value="reschedule"]');
    if (firstRadio) firstRadio.checked = true;
    document.getElementById('rescheduleFields').hidden = false;
    document.getElementById('proposeError').hidden = true;
    document.getElementById('proposeOverlay')?.removeAttribute('hidden');
  }

  function getCurrentUser() {
    // The logged-in user. The role switcher only changes the home layout.
    if (state.me && state.me.name) return state.me.name;
    const c = state.caregivers || [];
    return (c[0] && c[0].name) || '';
  }

  // Human label for a YYYY-MM-DD date, relative to the real current date.
  function formatDateLabel(iso) {
    if (!iso) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso; // already a label / legacy value
    if (iso === todayISO()) return 'Today';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (iso === toISODate(tomorrow)) return 'Tomorrow';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'];
    const [y, m, d] = iso.split('-').map(Number);
    return y === new Date().getFullYear()
      ? `${months[m - 1]} ${d}`
      : `${months[m - 1]} ${d}, ${y}`;
  }

  function setupLogoReset() {
    const logoBtn = document.getElementById('logoBtn');
    if(logoBtn) {
      logoBtn.addEventListener('click', () => window.location.reload() );
    }
  }

  function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view');
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          tabBtns.forEach(b => b.classList.remove('active'));
          views.forEach(v => v.classList.remove('active'));
          
          btn.classList.add('active');
          const target = btn.getAttribute('data-view');
          const targetView = document.getElementById(`view-${target}`);
          if (targetView) {
            targetView.classList.add('active');
            if(target === 'schedule') renderCalendar(); 
          }
        } catch(err) {}
      });
    });
  }

  function setupRoleSwitcher() {
    const roleBtns = document.querySelectorAll('.role-btn');
    roleBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        try {
          roleBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.role = btn.getAttribute('data-role');
          
          const roleText = document.getElementById('profileRole');
          if (roleText) {
            roleText.innerText = state.role === 'family' ? 'Family Member' : 'Caregiver';
          }
          renderCalendar();
          renderScheduleTable();
        } catch(err) {}
      });
    });
  }

  function setupDropdowns() {
    const notifBtn = document.getElementById('notifBtn');
    const notifPanel = document.getElementById('notifPanel');
    const notifList = document.getElementById('notifList');
    const notifDot = document.getElementById('notifDot');

    if(notifBtn && notifPanel) {
      renderNotifications();
      notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = notifPanel.hasAttribute('hidden');
        if (isHidden) {
          notifPanel.removeAttribute('hidden');
          if(notifDot) notifDot.style.display = 'none';
        } else {
          notifPanel.setAttribute('hidden', 'true');
        }
      });
      document.addEventListener('click', (e) => {
        if(!notifBtn.contains(e.target) && !notifPanel.contains(e.target)) {
          notifPanel.setAttribute('hidden', 'true');
        }
      });
    }
  }

  function setupFilters() {
    // Delegated so dynamically-rendered caregiver chips work too.
    document.querySelectorAll('.filter-group').forEach(group => {
      group.addEventListener('click', (e) => {
        const chip = e.target.closest('.filter-chip');
        if (!chip || !group.contains(chip)) return;
        group.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (chip.hasAttribute('data-filter-caregiver')) {
          state.activeFilters.caregiver = chip.getAttribute('data-filter-caregiver');
        }
        if (chip.hasAttribute('data-filter-category')) {
          state.activeFilters.category = chip.getAttribute('data-filter-category');
        }
        renderScheduleTable();
      });
    });
  }

  // Rebuild the caregiver filter row from the current family's members.
  function renderCaregiverFilters() {
    const wrap = document.getElementById('caregiverFilters');
    if (!wrap) return;
    const names = state.caregivers.map(c => c.name);
    const valid = new Set(['all', 'unassigned', ...names.map(n => n.toLowerCase())]);
    if (!valid.has(state.activeFilters.caregiver)) state.activeFilters.caregiver = 'all';
    const active = state.activeFilters.caregiver;

    const chip = (val, label) =>
      `<button class="filter-chip${active === val ? ' active' : ''}" data-filter-caregiver="${val}" type="button">${label}</button>`;

    wrap.innerHTML = [
      chip('all', 'All'),
      ...names.map(n => chip(n.toLowerCase(), displayName(n))),
      chip('unassigned', 'Unassigned'),
    ].join('');
  }

  function renderNotifications() {
    const list = document.getElementById('notifList');
    const dot = document.getElementById('notifDot');
    if (!list) return;
    const items = [];
    (state.tasks || []).forEach(t => {
      if (t.status === 'conflict' || t._status === 'uncovered_urgent' || t._status === 'handoff_requested') {
        items.push(`⚠️ "${t.title}" needs coverage`);
      }
    });
    const unassigned = (state.tasks || []).filter(t => t.assignee === 'Unassigned' && t.status !== 'done').length;
    if (unassigned) items.push(`🔔 ${unassigned} task${unassigned > 1 ? 's' : ''} still unassigned`);
    list.innerHTML = items.length
      ? items.slice(0, 6).map(i => `<li>${i}</li>`).join('')
      : `<li style="opacity:0.7">No new notifications</li>`;
    if (dot) dot.style.display = items.length ? '' : 'none';
  }

  function renderDependentsHome() {
    const wrap = document.getElementById('homeDependents');
    if (!wrap) return;
    const deps = state.dependents || [];
    wrap.innerHTML = deps.length
      ? deps.map(d => `
          <span class="dependent-pill">
            <span class="dep-name">${displayName(d.name)}</span>${d.relation ? `<span class="rel">${d.relation}</span>` : ''}
          </span>
        `).join('')
      : `<span class="empty">No one added yet — add a dependent in your profile.</span>`;
  }

  function setupDoneToggle() {
    const doneToggleBtn = document.getElementById('doneToggleBtn');
    const doneWrap = document.getElementById('doneWrap');
    if(doneToggleBtn && doneWrap) {
      doneToggleBtn.addEventListener('click', () => {
        const isHidden = doneWrap.hasAttribute('hidden');
        if(isHidden) doneWrap.removeAttribute('hidden');
        else doneWrap.setAttribute('hidden', 'true');
      });
    }
  }

  function setupCalendarArrows() {
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');

    if(nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        state.currentWeek++;
        renderCalendar();
        renderScheduleTable();
      });
    }
    
    if(prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        state.currentWeek--;
        renderCalendar();
        renderScheduleTable();
      });
    }
  }

  function setupAddTask() {
    const globalBtn = document.getElementById('globalAddTaskBtn');
    const overlay = document.getElementById('addTaskOverlay');
    const closeBtn = document.getElementById('addTaskCloseBtn');
    const form = document.getElementById('addTaskForm');
    const dateInput = document.getElementById('newTaskDate');
    const errorEl = document.getElementById('addTaskError');

    const setError = (msg) => {
      if (!errorEl) return;
      if (msg) { errorEl.textContent = msg; errorEl.hidden = false; }
      else { errorEl.textContent = ''; errorEl.hidden = true; }
    };

    const openModal = () => {
      const today = todayISO();
      if (dateInput) {
        dateInput.min = today;
        if (!dateInput.value || dateInput.value < today) dateInput.value = today;
      }
      // Populate "For whom?" from the family's dependents.
      const depWrap = document.getElementById('newTaskDependentWrap');
      const depSel = document.getElementById('newTaskDependent');
      const deps = state.dependents || [];
      if (depWrap && depSel) {
        if (deps.length) {
          depSel.innerHTML =
            deps.map(d => `<option value="${d.id}">${displayName(d.name)}${d.relation ? ` (${d.relation})` : ''}</option>`).join('') +
            `<option value="">Not for a specific person</option>`;
          depWrap.hidden = false;
        } else {
          depSel.innerHTML = '';
          depWrap.hidden = true;
        }
      }
      setError(null);
      if (overlay) overlay.removeAttribute('hidden');
    };

    if(globalBtn && overlay) {
      globalBtn.addEventListener('click', openModal);
    }
    if(closeBtn && overlay) {
      closeBtn.addEventListener('click', () => overlay.setAttribute('hidden', 'true'));
    }
    if(form) form.addEventListener('input', () => setError(null));

    if(form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = document.getElementById('newTaskTitle').value;
        const cat = document.getElementById('newTaskCategory').value;
        const timeRaw = document.getElementById('newTaskTime').value;
        const dateVal = (dateInput && dateInput.value) || todayISO();
        const priorityVal = document.getElementById('newTaskPriority')?.value || 'medium';

        // Block tasks whose date + time is already in the past (real now).
        if (isInPast(dateVal, timeRaw)) {
          setError('That date and time are already in the past. Pick a future time.');
          return;
        }

        const depSel = document.getElementById('newTaskDependent');
        const { error } = await createTask({
          title,
          category: cat,
          time: timeRaw || '', // blank -> "any time that day" (stored as null)
          date: dateVal,
          assignee: 'Unassigned',
          priority: priorityVal,
          status: 'pending',
          source: 'manual',
          dependentId: (depSel && depSel.value) || null
        });

        if (error) {
          setError('Could not save task: ' + error.message);
          return;
        }

        form.reset();
        setError(null);
        overlay.setAttribute('hidden', 'true');
        showToast("New task added to Unassigned!");

        await refreshTasks();
        document.querySelector('.tab-btn[data-view="schedule"]').click();
      });
    }
  }

  function setupModals() {
    const emBtn = document.getElementById('emergencyBtn');
    const emOverlay = document.getElementById('emergencyOverlay');
    const emClose = document.getElementById('emergencyCloseBtn');
    const emRows = document.getElementById('emergencyRows');

    const openEmergency = () => {
      const emName = document.getElementById('emergencyDependentName');
      const names = (state.dependents || []).map(d => displayName(d.name));
      if (emName) emName.innerText = names.length ? names.join(', ') : '—';
      if(emRows) {
        const me = getCurrentUser();
        const other = (state.caregivers.find(c => c.name && c.name !== me) || {}).name;
        emRows.innerHTML = `
          ${other ? `
          <div class="em-row">
            <div class="em-info"><strong>${displayName(other)}</strong><span>Family member • available</span></div>
            <button class="btn btn-primary btn-small">Call</button>
          </div>` : ''}
          <div class="em-row">
            <div class="em-info"><strong>Nearest hospital</strong><span>Emergency services</span></div>
            <button class="btn btn-secondary btn-small">Call 911</button>
          </div>
        `;
      }
      if(emOverlay) emOverlay.removeAttribute('hidden');
    };

    if(emBtn) emBtn.addEventListener('click', openEmergency);
    if(emClose) emClose.addEventListener('click', () => emOverlay.setAttribute('hidden', 'true'));

    const profBtn = document.getElementById('profileBtn');
    const profOverlay = document.getElementById('profileOverlay');
    const profClose = document.getElementById('profileCloseBtn');

    if(profBtn) profBtn.addEventListener('click', () => {
      if(profOverlay) profOverlay.removeAttribute('hidden');
      renderFamilySettings();
    });
    if(profClose) profClose.addEventListener('click', () => { if(profOverlay) profOverlay.setAttribute('hidden', 'true'); });

    const logoutBtn = document.getElementById('logoutBtn');
    if(logoutBtn) logoutBtn.addEventListener('click', async () => {
      await signOut();
      window.location.replace('login.html');
    });

    const copyBtn = document.getElementById('copyInviteBtn');
    if(copyBtn) copyBtn.addEventListener('click', async () => {
      const code = state.family && state.family.invite_code;
      if(!code) return;
      try {
        await navigator.clipboard.writeText(code);
        showToast('Invite code copied.');
      } catch {
        showToast('Invite code: ' + code);
      }
    });

    const memberList = document.getElementById('familyMemberList');
    if(memberList) memberList.addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-remove-member');
      if(!id) return;
      const member = state.familyMembers && state.familyMembers.find(m => m.id === id);
      if(!member) return;
      if(!confirm(`Remove ${member.name} from ${state.family ? state.family.name : 'the family'}?`)) return;
      const { error } = await removeFamilyMember(id);
      if(error) { showToast('Could not remove member: ' + error.message); return; }
      showToast(`${member.name} removed from the family.`);
      await renderFamilySettings();
      await refreshTasks();
    });

    const depForm = document.getElementById('addDependentForm');
    if(depForm) depForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameEl = document.getElementById('newDependentName');
      const relEl = document.getElementById('newDependentRelation');
      const name = nameEl.value.trim();
      if(!name) return;
      const { error } = await addDependent(name, relEl.value);
      if(error) { showToast('Could not add dependent: ' + error.message); return; }
      nameEl.value = ''; relEl.value = '';
      showToast(`${name} added.`);
      await refreshDependents();
    });

    const depList = document.getElementById('dependentList');
    if(depList) depList.addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-remove-dependent');
      if(!id) return;
      const dep = (state.dependents || []).find(d => d.id === id);
      if(!dep) return;
      if(!confirm(`Remove ${dep.name} as a dependent?`)) return;
      const { error } = await removeDependent(id);
      if(error) { showToast('Could not remove dependent: ' + error.message); return; }
      showToast(`${dep.name} removed.`);
      await refreshDependents();
    });

    const emForm = document.getElementById('emergencyContactForm');
    if(emForm) emForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await updateFamily({
        emergencyName: document.getElementById('emContactName').value,
        emergencyInfo: document.getElementById('emContactInfo').value,
      });
      if(error) { showToast('Could not save: ' + error.message); return; }
      showToast('Emergency contact saved.');
      state.family = await getFamily();
    });
  }

  async function refreshDependents() {
    state.dependents = await getDependents();
    renderDependents();
    renderDependentsHome();
    applyIdentity();
  }

  function renderDependents() {
    const listEl = document.getElementById('dependentList');
    if (!listEl) return;
    const deps = state.dependents || [];
    listEl.innerHTML = deps.length
      ? deps.map(d => `
          <li>
            <span>${displayName(d.name)}${d.relation ? ` <span class="fm-you">${d.relation}</span>` : ''}</span>
            <button class="fm-remove" data-remove-dependent="${d.id}" type="button">Remove</button>
          </li>`).join('')
      : '<li style="background:transparent; color:var(--color-sage); padding-left:0;">No dependents yet — add one below.</li>';
  }

  function rebuildCaregivers(members) {
    state.caregivers = (members || []).map((u) => ({
      name: u.name,
      id: u.id,
      auth_id: u.auth_id || null,
      load: 0, // real value computed in renderWorkload from actual task counts
      initials: u.name.slice(0, 2).toUpperCase()
    }));
  }

  // Members who can vote / be asked to cover = those with a login.
  function votingMembers() {
    return state.caregivers.filter(c => c.auth_id);
  }

  async function renderFamilySettings() {
    const nameEl = document.getElementById('familyName');
    const codeEl = document.getElementById('familyInviteCode');
    const listEl = document.getElementById('familyMemberList');
    if (state.family) {
      if (nameEl) nameEl.innerText = state.family.name;
      if (codeEl) codeEl.innerText = state.family.invite_code;
      const emN = document.getElementById('emContactName');
      const emI = document.getElementById('emContactInfo');
      if (emN) emN.value = state.family.emergency_contact_name || '';
      if (emI) emI.value = state.family.emergency_contact_info || '';
    }
    if (!listEl) return;

    const members = await loadUsers(); // also refreshes the api.js name<->id maps
    state.familyMembers = members;
    rebuildCaregivers(members);
    const myId = state.me && state.me.id;

    listEl.innerHTML = members.map(m => {
      const isMe = m.id === myId;
      return `
        <li>
          <span>${displayName(m.name)}${isMe ? '<span class="fm-you">you</span>' : ''}</span>
          ${isMe ? '' : `<button class="fm-remove" data-remove-member="${m.id}" type="button">Remove</button>`}
        </li>`;
    }).join('');

    state.dependents = await getDependents();
    renderDependents();
  }

  function showToast(message) {
    const container = document.getElementById('toastContainer');
    if(!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function setupChaosEngine() {
    const generateBtn = document.getElementById('generateBtn');
    const chaosInput = document.getElementById('chaosInput');
    const imageUpload = document.getElementById('chaosImageUpload');
    const previewWrap = document.getElementById('imagePreviewWrap');
    const previewStrip = document.getElementById('imagePreviewStrip');
    const removeImageBtn = document.getElementById('removeImageBtn');

    const chaosEmpty = document.getElementById('chaosEmpty');
    const chaosLoading = document.getElementById('chaosLoading');
    const chaosLoadingText = document.getElementById('chaosLoadingText');
    const chaosResults = document.getElementById('chaosResults');
    const extractedList = document.getElementById('extractedList');
    const addToCalendarBtn = document.getElementById('addToCalendarBtn');

    // Multiple "Upload Notes" images — accumulated across picks, each removable.
    let stagedImages = [];

    function syncImageInput() {
      if (!imageUpload) return;
      const dt = new DataTransfer();
      stagedImages.forEach(f => dt.items.add(f));
      imageUpload.files = dt.files; // programmatic set does not re-fire 'change'
    }

    function renderImagePreviews() {
      if (!previewStrip || !previewWrap) return;
      if (stagedImages.length === 0) {
        previewStrip.innerHTML = '';
        previewWrap.setAttribute('hidden', 'true');
        syncImageInput();
        return;
      }
      previewWrap.removeAttribute('hidden');
      previewStrip.innerHTML = stagedImages.map((f, i) => `
        <div class="preview-thumb">
          <img alt="Note ${i + 1}" src="${URL.createObjectURL(f)}" />
          <button type="button" class="preview-thumb-x" data-img-remove="${i}" aria-label="Remove note ${i + 1}">&times;</button>
        </div>`).join('');
      syncImageInput();
    }

    if(imageUpload) {
      imageUpload.addEventListener('change', function () {
        for (const f of this.files) {
          if (f.type.startsWith('image/')) stagedImages.push(f);
        }
        renderImagePreviews();
      });
    }

    if(previewStrip) {
      previewStrip.addEventListener('click', (e) => {
        const idx = e.target.getAttribute('data-img-remove');
        if (idx === null) return;
        stagedImages.splice(Number(idx), 1);
        renderImagePreviews();
      });
    }

    if(removeImageBtn) {
      removeImageBtn.addEventListener('click', () => {
        stagedImages = [];
        renderImagePreviews();
      });
    }

    // Send the typed message and/or uploaded screenshots to the server, which
    // runs Gemini, reads names straight from the conversation, and matches them
    // against this family's members. Returns true on success.
    async function runServerExtraction(message) {
      const stamp = Date.now();
      try {
        const fd = new FormData();
        stagedImages.forEach(f => fd.append('images', f));
        if (message && message.trim()) fd.append('message', message.trim());
        if (state.family && state.family.id) fd.append('familyId', state.family.id);

        const res = await fetch('/api/extract', { method: 'POST', body: fd });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `server responded ${res.status}`);
        }
        const { tasks } = await res.json();

        state.stagedTasks = (tasks || []).slice(0, 12).map((t, i) => ({
          id: `stg-${stamp}-${i}`,
          title: t.title || 'Untitled task',
          date: t.date,
          time: (t.time || '').slice(0, 5), // '' = no time given
          assignee: t.assignee || 'Unassigned',
          category: t.category || 'general',
          duplicateOf: t.duplicateOf || null,
        }));
        renderStagedTasks();
        if (state.stagedTasks.length === 0) showToast('No tasks found.');
        return true;
      } catch (err) {
        console.warn('Server extraction failed:', err);
        if (stagedImages.length > 0) {
          if (chaosLoading) chaosLoading.setAttribute('hidden', 'true');
          if (chaosEmpty) chaosEmpty.removeAttribute('hidden');
          showToast(`Couldn't read the screenshots: ${err.message}. Is "node server.mjs" running?`);
        }
        return false;
      }
    }

    // Offline fallback — a heuristic parse of the typed message (no server, no
    // name matching). Only used when the server can't be reached.
    function runExtraction(rawText) {
      const text = (rawText || '').trim();
      const stamp = Date.now();

      const shiftDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
      const nextWeekday = (target) => {
        const d = new Date();
        const diff = ((target - d.getDay() + 7) % 7) || 7;
        d.setDate(d.getDate() + diff);
        return d;
      };
      const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

      const parseOne = (line, i) => {
        const lower = line.toLowerCase();

        let date = toISODate(shiftDays(1)); // default: tomorrow
        if (/\btoday\b|\btonight\b/.test(lower)) date = todayISO();
        else if (/\btomorrow\b/.test(lower)) date = toISODate(shiftDays(1));
        else {
          const wd = WEEKDAYS.findIndex(d => lower.includes(d));
          if (wd >= 0) date = toISODate(nextWeekday(wd));
        }

        let time = ''; // '' = no time mentioned -> not flagged as past
        const ampm = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
        if (ampm) {
          let h = Number(ampm[1]) % 12;
          if (ampm[3] === 'pm') h += 12;
          time = `${String(h).padStart(2,'0')}:${String(ampm[2] ? Number(ampm[2]) : 0).padStart(2,'0')}`;
        } else {
          const h24 = lower.match(/\b(\d{1,2}):(\d{2})\b/) || lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
          if (h24) {
            const h = Number(h24[1]);
            const min = h24[2] ? Number(h24[2]) : 0;
            if (h <= 23 && min <= 59) time = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
          }
        }

        let category = 'general';
        if (/\b(medicine|medication|meds?|pills?|prescription|dose|tablets?|insulin)\b/.test(lower)) category = 'medication';
        else if (/\b(doctor|appointment|appt|clinic|physio|therapy|checkup|hospital|scan|x-?ray|dialysis)\b/.test(lower)) category = 'appointment';
        else if (/\b(grocery|groceries|shop|shopping|buy|pick ?up|market|store|milk|apples?|fruit|vegetables?)\b/.test(lower)) category = 'grocery';

        const title = line.replace(/\s+/g, ' ').trim().slice(0, 80).replace(/^./, c => c.toUpperCase());
        return { id: `stg-${stamp}-${i}`, title: title || 'New task', date, time, assignee: 'Unassigned', category };
      };

      if (!text) {
        state.stagedTasks = [];
      } else {
        let lines = text.split(/\n+|;+|,+|\s+\band\b\s+|\s+\bthen\b\s+/i).map(s => s.trim()).filter(Boolean);
        if (lines.length === 0) lines = [text];
        state.stagedTasks = lines.slice(0, 8).map(parseOne);
      }

      renderStagedTasks();
    }

    // A staged task the AI assigned to a real family member, at a time that
    // would double-book them — either against something already on the
    // calendar, OR against another task in this same batch.
    const stagedConflict = (s) => {
      if (!s.assignee || s.assignee === 'Unassigned' || !s.time) return null;
      const siblings = state.stagedTasks
        .filter(o => o !== s)
        .map(o => ({
          id: o.id, title: o.title, assignee: o.assignee, status: 'pending',
          _date: o.date, _time: o.time,
          date: o.date, time: o.time ? formatTime(o.time) : 'Any time',
        }));
      return findConflict(s.assignee, s.date, s.time, [...state.tasks, ...siblings], s.id);
    };

    const stagedFlagged = (s) => isInPast(s.date, s.time) || !!s.duplicateOf || !!stagedConflict(s);

    function renderStagedTasks() {
      if (!extractedList) return;
      const items = state.stagedTasks;

      if (items.length === 0) {
        extractedList.innerHTML = '';
        if (chaosResults) chaosResults.setAttribute('hidden', 'true');
        if (chaosEmpty) chaosEmpty.removeAttribute('hidden');
        return;
      }

      if (chaosEmpty) chaosEmpty.setAttribute('hidden', 'true');
      if (chaosLoading) chaosLoading.setAttribute('hidden', 'true');
      if (chaosResults) chaosResults.removeAttribute('hidden');

      const flagged = items.filter(stagedFlagged).length;
      const ready = items.length - flagged;

      const head = document.getElementById('extractedCount');
      if (head) {
        head.textContent = flagged
          ? `${ready} ready to add · ${flagged} flagged for review`
          : 'Review pending tasks';
      }

      extractedList.innerHTML = items.map(s => {
        const past = isInPast(s.date, s.time);
        const dup = s.duplicateOf;
        const clash = (!past && !dup) ? stagedConflict(s) : null;
        const flag = past || !!dup || !!clash;
        const badge = past ? '⚠ Past date'
          : dup ? '⚠ Possible duplicate'
          : clash ? '⚠ Double-booking'
          : 'Pending Review';
        const warn = past
          ? 'This date and time have already passed — review before adding.'
          : dup ? `Looks like "<strong>${dup.title}</strong>" (${formatDateLabel(dup.date)}${dup.time ? ' · ' + formatTime(dup.time) : ''}${dup.assignee && dup.assignee !== 'Unassigned' ? ' · ' + dup.assignee : ''}) is already on the calendar.`
          : clash ? (
              String(clash.id).startsWith('stg-')
                ? `Overlaps with "<strong>${clash.title}</strong>" (${formatDateLabel(clash.date)}${clash.time && clash.time !== 'Any time' ? ' · ' + clash.time : ''}), also in this batch for ${s.assignee} — adding both would double-book them.`
                : `${s.assignee} already has "<strong>${clash.title}</strong>" (${formatDateLabel(clash.date)}${clash.time && clash.time !== 'Any time' ? ' · ' + clash.time : ''}) around then — adding this would double-book them.`
            )
          : '';
        return `
          <div class="task-card staged ${flag ? 'flagged' : ''}" data-stg="${s.id}">
            <span class="staged-badge">${badge}</span>
            <div class="task-time">${formatDateLabel(s.date)}<br>${s.time ? formatTime(s.time) : 'Any time'}</div>
            <div class="task-details">
              <strong>${s.title}</strong>
              <div class="task-meta"><span>${s.assignee}</span></div>
            </div>
            ${flag ? `
              <div class="staged-warning">${warn}</div>
              <div class="staged-actions">
                <button class="btn btn-secondary btn-small" data-stg-add="${s.id}" type="button">Add anyway</button>
                <button class="btn btn-ghost btn-small" data-stg-discard="${s.id}" type="button">Discard</button>
              </div>` : ''}
          </div>`;
      }).join('');

      if (addToCalendarBtn) {
        addToCalendarBtn.disabled = ready === 0;
        addToCalendarBtn.textContent = ready > 0
          ? `Confirm & Add ${ready} Task${ready > 1 ? 's' : ''} to Calendar`
          : 'Resolve flagged tasks to continue';
      }
    }

    async function addStagedTask(staged, { reviewed = false } = {}) {
      return createTask({
        title: staged.title,
        category: staged.category,
        time: staged.time,
        date: staged.date,
        assignee: staged.assignee,
        priority: 'medium',
        status: 'pending',
        source: reviewed ? 'ai_extracted_reviewed' : 'ai_extracted'
      });
    }

    if(generateBtn) {
      generateBtn.addEventListener('click', async () => {
        const msg = chaosInput ? chaosInput.value.trim() : '';
        const imgCount = stagedImages.length;

        if (!msg && imgCount === 0) return;

        if(chaosEmpty) chaosEmpty.setAttribute('hidden', 'true');
        if(chaosResults) chaosResults.setAttribute('hidden', 'true');
        if(chaosLoading) chaosLoading.removeAttribute('hidden');
        if(chaosLoadingText) chaosLoadingText.innerText =
          imgCount ? `Reading ${imgCount > 1 ? imgCount + ' notes' : 'the note'}${msg ? ' + message' : ''}…` : 'Reading your message…';

        const ok = await runServerExtraction(msg);

        // Server unreachable and it was text-only -> local fallback parser.
        if (!ok && msg && imgCount === 0) {
          if(chaosLoadingText) chaosLoadingText.innerText = 'Reading your message…';
          runExtraction(msg);
        }
      });
    }

    // Per-card actions on flagged (past-dated) extracted tasks.
    if(extractedList) {
      extractedList.addEventListener('click', async (e) => {
        const addId = e.target.getAttribute('data-stg-add');
        const discardId = e.target.getAttribute('data-stg-discard');

        if (addId) {
          const staged = state.stagedTasks.find(s => s.id === addId);
          if (!staged) return;
          const { error } = await addStagedTask(staged, { reviewed: true });
          if (error) { showToast('Could not add task: ' + error.message); return; }
          state.stagedTasks = state.stagedTasks.filter(s => s.id !== addId);
          renderStagedTasks();
          await refreshTasks();
          showToast('Task added after review.');
        }

        if (discardId) {
          state.stagedTasks = state.stagedTasks.filter(s => s.id !== discardId);
          renderStagedTasks();
          showToast('Flagged task discarded.');
        }
      });
    }

    if(addToCalendarBtn) {
      addToCalendarBtn.addEventListener('click', async () => {
        const ready = state.stagedTasks.filter(s => !stagedFlagged(s));
        if (ready.length === 0) return;

        let added = 0;
        for (const staged of ready) {
          const { error } = await addStagedTask(staged);
          if (!error) added++;
        }

        // Keep flagged tasks (past date / possible duplicate) for review.
        state.stagedTasks = state.stagedTasks.filter(stagedFlagged);
        const stillFlagged = state.stagedTasks.length;

        if(chaosInput) chaosInput.value = '';
        stagedImages = [];
        renderImagePreviews();

        renderStagedTasks();
        await refreshTasks();

        showToast(
          `${added} task${added > 1 ? 's' : ''} added to the shared calendar.` +
          (stillFlagged ? ` ${stillFlagged} flagged for review.` : '')
        );

        // Stay on the review panel if past-dated tasks still need attention.
        if (stillFlagged === 0) {
          document.querySelector('.tab-btn[data-view="schedule"]').click();
        }
      });
    }
  }

  function setupChat() {
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatLog = document.getElementById('chatLog');
    const sendBtn = document.getElementById('sendBtn');
    const suggestions = document.getElementById('suggestedQuestions');
    if (!chatForm || !chatLog) return;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const scroll = () => { chatLog.scrollTop = chatLog.scrollHeight; };

    const addBubble = (who, html) => {
      const div = document.createElement('div');
      div.className = `chat-msg ${who}`;
      div.innerHTML = html;
      chatLog.appendChild(div);
      scroll();
      return div;
    };

    chatLog.innerHTML = '';
    addBubble('bot', "Hi — I can look up real places near your family: pharmacies, hospitals, clinics, transport, in-home help. Ask away.");

    if (suggestions) {
      const chips = ['24 hour pharmacy', 'Nearest hospital', 'Physiotherapy clinic', 'Wheelchair rental'];
      suggestions.innerHTML = chips.map((c) => `<button class="chip-btn" type="button">${c}</button>`).join('');
      suggestions.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-btn');
        if (!btn) return;
        chatInput.value = btn.textContent;
        chatForm.requestSubmit ? chatForm.requestSubmit() : chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    }

    const resultCard = (r) => `
      <div class="resource-card">
        <strong>${esc(r.name)}</strong>
        ${r.kind ? `<span class="resource-kind">${esc(r.kind)}</span>` : ''}
        ${r.address ? `<div class="resource-addr">${esc(r.address)}</div>` : ''}
        <div class="resource-links">
          <a class="btn btn-secondary btn-small" href="${esc(r.mapUrl)}" target="_blank" rel="noopener">View on map</a>
          <a class="resource-link-alt" href="${esc(r.gmapsUrl)}" target="_blank" rel="noopener">Google Maps</a>
        </div>
      </div>`;

    let busy = false;

    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = chatInput.value.trim();
      if (!msg || busy) return;

      busy = true;
      if (sendBtn) sendBtn.disabled = true;
      addBubble('user', esc(msg));
      chatInput.value = '';

      const typing = addBubble('bot typing', '<span></span><span></span><span></span>');

      try {
        const res = await fetch('/api/resource-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        });
        const data = await res.json().catch(() => ({}));
        typing.remove();

        if (!res.ok) {
          addBubble('bot', esc(data.error || "Something went wrong. Try again in a moment."));
        } else if (!data.results || data.results.length === 0) {
          addBubble('bot',
            `I couldn't find anything for that${data.location ? ` around ${esc(data.location)}` : ''}. ` +
            `Try rephrasing — e.g. "pharmacy in Katpadi" or "hospital near Vellore".`
          );
        } else {
          const where = data.usedDefaultLocation && data.location
            ? ` near <strong>${esc(data.location)}</strong> (no location in your question, so I used the family's default)`
            : data.location ? ` around <strong>${esc(data.location)}</strong>` : '';
          addBubble('bot',
            `Here${data.results.length > 1 ? ` are ${data.results.length}` : `'s a`} ${esc(data.keywords || 'result')} option${data.results.length > 1 ? 's' : ''}${where}:` +
            data.results.map(resultCard).join('')
          );
        }
      } catch (err) {
        typing.remove();
        addBubble('bot', "I couldn't reach the resource service. Check the connection and try again.");
      } finally {
        busy = false;
        if (sendBtn) sendBtn.disabled = false;
        chatInput.focus();
      }
    });
  }

  function renderAll() {
    renderMembersRow();
    renderCaregiverFilters();
    renderDependentsHome();
    renderNotifications();
    renderUrgentZone();
    renderDecisions();
    renderMiniTasks();
    renderConflict();
    renderWorkload();
    renderCalendar();
    renderScheduleTable();
  }

  function renderMembersRow() {
    const row = document.getElementById('membersRow');
    const schedRow = document.getElementById('membersRowSchedule');
    let html = '';
    state.caregivers.forEach(c => {
      html += `<div class="member-avatar" title="${displayName(c.name)}">${c.initials}</div>`;
    });
    if(row) row.innerHTML = html;
    if(schedRow) schedRow.innerHTML = html;
  }

  function renderMiniTasks() {
    const list = document.getElementById('miniTaskList');
    if(!list) return;
    let html = '';
    const today = todayISO();
    const pendingTasks = state.tasks.filter(t => t.status !== 'done' && (!t.date || t.date >= today));

    pendingTasks.slice(0,3).forEach(t => {
      html += `
        <li class="task-card ${t.priority === 'high' ? 'priority-high' : ''}">
          <div class="task-time">${formatDateLabel(t.date)} ${t.time}</div>
          <div class="task-details">
            <strong>${t.title}</strong>
            ${t.dependent ? `<div class="task-for">for ${displayName(t.dependent)}</div>` : ''}
            <div class="task-meta"><span>${displayName(t.assignee)}</span></div>
          </div>
        </li>
      `;
    });

    list.innerHTML = html;
  }

  function renderConflict() {
    const body = document.getElementById('conflictBody');
    const conflictTask = state.tasks.find(t => t.status === 'conflict');
    const chip = document.getElementById('conflictStatusChip');

    if(!body || !chip) return;

    if (conflictTask) {
      chip.className = 'status-chip danger';
      chip.innerText = 'Action Required';

      const cover = (state.caregivers.find(c => c.name && c.name !== conflictTask.assignee) || {}).name || getCurrentUser();
      const coverLabel = displayName(cover);
      const deadlinePassed =
        conflictTask._status === 'uncovered_urgent' ||
        isInPast(conflictTask._date, conflictTask._time);

      if (deadlinePassed) {
        body.innerHTML = `
          <p><strong>${conflictTask.title}</strong> was due ${formatDateLabel(conflictTask._date)}${conflictTask._time ? ' at ' + formatTime(conflictTask._time) : ''} and went uncovered.</p>
          <p style="color:var(--color-danger); margin-top:4px;">The deadline has passed — this task can no longer be claimed as upcoming.</p>
          <div class="ai-recommendation">
            <h3>AI Recommendation</h3>
            <p>Ask ${coverLabel} to cover it late, or mark it handled.</p>
            <button class="btn btn-primary btn-small" id="acceptConflictBtn" style="margin-top:12px">Assign ${coverLabel} to cover late</button>
          </div>
        `;
      } else {
        const who = conflictTask.assignee && conflictTask.assignee !== 'Unassigned'
          ? `is assigned to ${displayName(conflictTask.assignee)}, who can't cover it`
          : `needs someone to take it on`;
        body.innerHTML = `
          <p><strong>${conflictTask.title}</strong> (${conflictTask.time}) ${who}.</p>
          <div class="ai-recommendation">
            <h3>AI Recommendation</h3>
            <p>Reassign to ${coverLabel}.</p>
            <button class="btn btn-primary btn-small" id="acceptConflictBtn" style="margin-top:12px">Reassign to ${coverLabel}</button>
          </div>
        `;
      }

      document.getElementById('acceptConflictBtn').addEventListener('click', async () => {
        // Don't silently double-book the person we're asking to cover.
        const clash = cover && cover !== 'Unassigned' &&
          findConflict(cover, conflictTask._date, conflictTask._time, state.tasks, conflictTask.id);
        if (clash && !confirm(
          `${coverLabel} already has "${clash.title}" at ${formatDateLabel(clash.date)} ${clash.time}.\n\nAssign them anyway?`
        )) return;
        const { error } = await updateTask(conflictTask.id, { assignee: cover, status: 'pending' });
        if (error) { showToast('Could not resolve: ' + error.message); return; }
        showToast(
          clash ? `${coverLabel} assigned — heads up, they're now double-booked at ${clash.time}.`
          : deadlinePassed ? `${coverLabel} assigned to cover late.` : "Conflict Resolved!"
        );
        await refreshTasks();
      });
    } else {
      chip.className = 'status-chip success';
      chip.innerText = 'Resolved';
      body.innerHTML = `<p>No current scheduling conflicts.</p>`;
    }
  }

  function renderWorkload() {
    const barsContainer = document.getElementById('workloadBars');
    const warning = document.getElementById('workloadWarning');
    const action = document.getElementById('workloadAction');
    if(!barsContainer || !warning || !action) return;

    // Real load = each caregiver's share of the family's open (non-done) tasks.
    const active = state.tasks.filter(t => t.status !== 'done');
    const counts = {};
    state.caregivers.forEach(c => { counts[c.name] = 0; });
    active.forEach(t => { if (counts[t.assignee] != null) counts[t.assignee]++; });
    const assignedTotal = Object.values(counts).reduce((a, b) => a + b, 0);
    state.caregivers.forEach(c => {
      c.taskCount = counts[c.name] || 0;
      c.load = assignedTotal ? Math.round((c.taskCount / assignedTotal) * 100) : 0;
    });

    const busiest = state.caregivers.slice().sort((a, b) => b.taskCount - a.taskCount)[0];
    const evenShare = state.caregivers.length ? Math.ceil(100 / state.caregivers.length) : 100;

    if (busiest && busiest.taskCount >= 3 && busiest.load > evenShare + 20) {
      const lightest = state.caregivers.slice().sort((a, b) => a.taskCount - b.taskCount)[0];
      warning.innerHTML = `<p style="margin-bottom:12px"><strong>${displayName(busiest.name)}</strong> is carrying ${busiest.load}% of the open tasks.</p>`;
      action.innerHTML = `
        <div class="ai-recommendation">
          <h3>Suggestion</h3>
          <p>Spread some of ${displayName(busiest.name)}'s tasks${lightest && lightest.name !== busiest.name ? ` — ${displayName(lightest.name)} has the fewest right now` : ''}. Use <em>⚑ Propose</em> or <em>Not Available</em> on a task.</p>
        </div>`;
    } else if (assignedTotal === 0) {
      warning.innerHTML = `<p style="margin-bottom:12px; color:var(--color-sage); font-weight:600;">No tasks assigned yet.</p>`;
      action.innerHTML = '';
    } else {
      warning.innerHTML = `<p style="margin-bottom:12px; color:var(--color-sage); font-weight:600;">Workload is spread evenly.</p>`;
      action.innerHTML = '';
    }

    barsContainer.innerHTML = state.caregivers.map(c => `
      <div class="workload-row">
        <span class="wl-name" title="${c.name}">${displayName(c.name)}</span>
        <div class="wl-bar-bg"><div class="wl-bar-fill ${c.load > evenShare + 20 ? 'high' : ''}" style="width: ${c.load}%"></div></div>
        <span class="wl-val">${c.taskCount}</span>
      </div>`).join('');
  }

  function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calendarMonthLabel');
    if(!grid || !label) return;

    const headers = grid.querySelectorAll('.calendar-day-header');
    grid.innerHTML = '';
    headers.forEach(h => grid.appendChild(h));

    const currentUser = getCurrentUser();
    const today = todayISO();

    // Week grid anchored to the real current date.
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
    const startDate = new Date(baseDate);
    startDate.setDate(baseDate.getDate() - baseDate.getDay() + (state.currentWeek * 7));

    label.innerText = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    for(let i=0; i<7; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);

      const cellISO = toISODate(currentDate);
      const isToday = cellISO === today;
      const userHasTask = state.tasks.some(t => t.date === cellISO && t.assignee === currentUser);

      const hasTaskClass = userHasTask ? 'has-task' : '';
      const activeClass = isToday ? 'active' : '';
      const selectedClass = (state.selectedDate === cellISO) ? 'selected-day' : '';

      const dayDiv = document.createElement('div');
      dayDiv.className = `calendar-day ${activeClass} ${hasTaskClass} ${selectedClass}`;
      dayDiv.innerText = currentDate.getDate();

      dayDiv.addEventListener('click', () => {
        if (state.selectedDate === cellISO) {
          state.selectedDate = null;
          showToast("Showing all dates");
        } else {
          state.selectedDate = cellISO;
          showToast("Filtering by " + formatDateLabel(cellISO));
        }
        renderCalendar();
        renderScheduleTable();
      });

      grid.appendChild(dayDiv);
    }
  }

  // Task currently open in the recurring-task action modal.
  let activeActionTaskId = null;

  document.getElementById('scheduleTableBody')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-drop')) {
      openCoverModal(e.target.getAttribute('data-id'));
    }

    if (e.target.classList.contains('btn-propose')) {
      openProposeModal(e.target.getAttribute('data-id'));
    }

    if (e.target.classList.contains('btn-recurring')) {
      const taskId = e.target.getAttribute('data-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (task) openRecurringModal(task);
    }

    if (e.target.classList.contains('btn-done')) {
      const taskId = e.target.getAttribute('data-id');
      const { error } = await updateTask(taskId, { status: 'done' });
      if (error) { showToast('Could not mark complete: ' + error.message); return; }
      showToast('Task marked complete.');
      await refreshTasks();
    }

    if (e.target.classList.contains('btn-claim')) {
      await claimTaskFlow(e.target.getAttribute('data-id'));
    }
  });

  // Shared claim path: past-deadline guard, double-booking check, then an
  // atomic claim that loses gracefully if someone else got there first.
  async function claimTaskFlow(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const me = getCurrentUser();

    if (isInPast(task._date, task._time)) {
      if (task._status !== 'uncovered_urgent') {
        const { error } = await updateTask(taskId, { status: 'uncovered_urgent' });
        if (error) { showToast('Could not flag task: ' + error.message); return; }
      }
      showToast(`Deadline passed — "${task.title}" was due ${formatDateLabel(task._date)}${task._time ? ' at ' + formatTime(task._time) : ''}. It can no longer be claimed and is now flagged urgent / uncovered.`);
      await refreshTasks();
      return;
    }

    const conflict = findConflict(me, task._date, task._time, state.tasks, taskId);
    if (conflict) {
      showToast(`Can't claim — you already have "${conflict.title}" at ${formatDateLabel(conflict.date)} ${conflict.time}. That would double-book you.`);
      return;
    }

    const res = await claimTask(taskId, me);
    if (res.error) { showToast('Could not claim task: ' + res.error.message); return; }
    if (res.taken) { showToast('This task was just claimed by someone else.'); await refreshTasks(); return; }
    showToast(`Task claimed by ${me}!`);
    await refreshTasks();
  }

  document.getElementById('doneTableBody')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-reopen')) {
      const taskId = e.target.getAttribute('data-id');
      const { error } = await updateTask(taskId, { status: 'pending' });
      if (error) { showToast('Could not reopen: ' + error.message); return; }
      showToast('Task reopened.');
      await refreshTasks();
    }
  });

  // Opens the "Manage Recurring Task" modal, with reassign options built from
  // the current family's members. (Same skip / permanent-reassign choices as
  // recurringEngine.mjs, but run client-side against api.js.)
  function openRecurringModal(task) {
    activeActionTaskId = task.id;
    const promptEl = document.getElementById('recurringTaskTitlePrompt');
    if (promptEl) promptEl.innerText = `What would you like to do with "${task.title}" on ${formatDateLabel(task.date)}?`;
    const sel = document.getElementById('reassignTargetSelect');
    if (sel) {
      sel.innerHTML = state.caregivers.map(c => `<option value="${c.name}">${displayName(c.name)}</option>`).join('')
        + '<option value="Unassigned">Unassigned</option>';
    }
    document.getElementById('recurringActionOverlay')?.removeAttribute('hidden');
  }

  document.getElementById('recurringCloseBtn')?.addEventListener('click', () => {
    document.getElementById('recurringActionOverlay')?.setAttribute('hidden', 'true');
  });

  document.getElementById('skipOnceBtn')?.addEventListener('click', async () => {
    document.getElementById('recurringActionOverlay')?.setAttribute('hidden', 'true');
    if (!activeActionTaskId) return;
    const { error } = await updateTask(activeActionTaskId, { status: 'done' });
    if (error) { showToast('Could not skip task: ' + error.message); return; }
    showToast('Skipped this occurrence.');
    await refreshTasks();
  });

  document.getElementById('confirmReassignBtn')?.addEventListener('click', async () => {
    const newAssignee = document.getElementById('reassignTargetSelect').value;
    if (!activeActionTaskId) return;
    const rtask = state.tasks.find(x => x.id === activeActionTaskId);
    const conflict = newAssignee !== 'Unassigned' && rtask &&
      findConflict(newAssignee, rtask._date, rtask._time, state.tasks, activeActionTaskId);
    if (conflict && !confirm(
      `${displayName(newAssignee)} already has "${conflict.title}" at ${formatDateLabel(conflict.date)} ${conflict.time}.\n\nReassign anyway?`
    )) return;
    document.getElementById('recurringActionOverlay')?.setAttribute('hidden', 'true');
    const { error } = await updateTask(activeActionTaskId, { assignee: newAssignee, status: 'pending' });
    if (error) { showToast('Could not reassign: ' + error.message); return; }
    showToast(conflict ? `Reassigned to ${displayName(newAssignee)} — now double-booked at ${conflict.time}.` : `Task reassigned to ${displayName(newAssignee)}.`);
    await refreshTasks();
  });

  function renderScheduleTable() {
    const tbody = document.getElementById('scheduleTableBody');
    const doneTbody = document.getElementById('doneTableBody');
    if(!tbody || !doneTbody) return;
    
    let filteredTasks = state.tasks.filter(t => {
      const matchCaregiver = state.activeFilters.caregiver === 'all' || t.assignee.toLowerCase() === state.activeFilters.caregiver;
      const matchCategory = state.activeFilters.category === 'all' || t.category === state.activeFilters.category;
      const matchDate = !state.selectedDate || t.date === state.selectedDate;
      return matchCaregiver && matchCategory && matchDate;
    });

    const activeTasks = filteredTasks.filter(t => t.status !== 'done');
    const doneTasks = filteredTasks.filter(t => t.status === 'done');
    const currentUser = getCurrentUser();

    // Real workload-based suggestion for each unassigned task (backend engines).
    const suggestionFor = {};
    activeTasks.forEach(t => {
      if (t.assignee === 'Unassigned') {
        suggestionFor[t.id] =
          suggestAssignee(t, state.tasks, state.caregivers) || currentUser;
      }
    });

    if (activeTasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: #888;">No active tasks match these filters.</td></tr>`;
    } else {
      let activeHtml = '';
      activeTasks.forEach(t => {
        let assigneeHtml = displayName(t.assignee);
        let actionHtml = '';

        const deadlinePassed = isInPast(t._date, t._time);

        if (t.assignee === 'Unassigned') {
          assigneeHtml = `
            <span class="unassigned-text">Unassigned</span>
            <span class="ai-suggest">
              <svg viewBox="0 0 24 24" class="icon" style="width:12px;height:12px"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5"/></svg>
              AI Suggests: ${displayName(suggestionFor[t.id])}
            </span>
          `;
          actionHtml = deadlinePassed
            ? `<button class="btn-claim" data-id="${t.id}">Claim (deadline passed)</button>`
            : `<button class="btn-claim" data-id="${t.id}">Claim Task</button>`;
        }
        else if (t.assignee === currentUser) {
          actionHtml = `<button class="btn-drop" data-id="${t.id}">Not Available</button>`;
        }

        if (t._recurring) {
          actionHtml += ` <button class="btn-recurring" data-id="${t.id}" title="Manage recurring task">⟳ Manage</button>`;
        }
        actionHtml += ` <button class="btn-done" data-id="${t.id}" title="Mark complete">✓ Done</button>`;
        actionHtml += ` <button class="btn-propose" data-id="${t.id}" title="Propose delete / reschedule (family vote)">⚑ Propose</button>`;

        const noteworthy = t._status === 'uncovered_urgent' || t._status === 'handoff_requested';
        const statusLabel = (noteworthy ? t._status.replace(/_/g, ' ') : t.status).toUpperCase();
        const statusClass = (t.status === 'conflict' || deadlinePassed) ? 'danger' : 'success';

        activeHtml += `
          <tr>
            <td>${formatDateLabel(t.date)}</td>
            <td><strong>${t.time}</strong></td>
            <td>${t.title}${t.dependent ? `<div class="task-for">for ${displayName(t.dependent)}</div>` : ''}</td>
            <td><span class="status-chip">${t.category}</span></td>
            <td>${assigneeHtml}</td>
            <td>${t.priority.toUpperCase()}</td>
            <td><span class="status-chip ${statusClass}">${statusLabel}</span></td>
            <td><div class="row-actions">${actionHtml}</div></td>
          </tr>
        `;
      });
      tbody.innerHTML = activeHtml;
    }

    if (doneTasks.length === 0) {
      doneTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: #888;">No completed tasks yet.</td></tr>`;
    } else {
      let doneHtml = '';
      doneTasks.forEach(t => {
        doneHtml += `
          <tr>
            <td class="task-done-text">${formatDateLabel(t.date)}</td>
            <td class="task-done-text"><strong>${t.time}</strong></td>
            <td class="task-done-text">${t.title}${t.dependent ? `<div class="task-for">for ${displayName(t.dependent)}</div>` : ''}</td>
            <td><span class="status-chip done">${t.category}</span></td>
            <td><span class="task-done-text">${displayName(t.assignee)}</span></td>
            <td><span class="task-done-text">${t.priority.toUpperCase()}</span></td>
            <td><span class="status-chip done">${t.status.toUpperCase()}</span></td>
            <td><button class="btn-reopen" data-id="${t.id}" title="Move back to active">↺ Reopen</button></td>
          </tr>
        `;
      });
      doneTbody.innerHTML = doneHtml;
    }
  }
});