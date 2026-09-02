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
  formatTime
} from './api.js';

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    role: 'caregiver',
    activeFilters: { caregiver: 'all', category: 'all' },
    currentWeek: 0,
    selectedDate: null,
    tasks: [],
    stagedTasks: [],
    caregivers: [
      { name: 'Priya', load: 82, initials: 'PR' },
      { name: 'Arun', load: 54, initials: 'AR' },
      { name: 'Meera', load: 39, initials: 'MR' }
    ]
  };

  const body = document.body;

  const safeRun = (name, fn) => {
    try { fn(); } 
    catch(e) { console.warn(`Skipping ${name} setup:`, e); }
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
  safeRun('Initial Render', renderAll);

  let _refreshTimer = null;
  initData();

  async function initData() {
    try {
      const users = await loadUsers();
      if (users && users.length) {
        const MOCK_LOADS = [82, 54, 39];
        state.caregivers = users.slice(0, 3).map((u, i) => ({
          name: u.name,
          id: u.id,
          load: MOCK_LOADS[i] != null ? MOCK_LOADS[i] : 50,
          initials: u.name.slice(0, 2).toUpperCase()
        }));
      }
      await refreshTasks();
      subscribeToTasks(() => {
        clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(refreshTasks, 200);
      });
    } catch (err) {
      console.error('Backend init failed:', err);
      showToast('Could not reach the server — working offline.');
      renderAll();
    }
  }

  async function refreshTasks() {
    const { data, error } = await getTasks();
    if (!error && data) state.tasks = data;
    renderAll();
  }

  function getCurrentUser() {
    const c = state.caregivers || [];
    if (state.role === 'caregiver') return (c[0] && c[0].name) || 'Priya';
    if (state.role === 'family') return (c[1] && c[1].name) || 'Priya';
    return (c[2] && c[2].name) || 'Priya';
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
          
          const greetingName = document.getElementById('greetingName');
          const roleText = document.getElementById('profileRole');
          
          if(state.role === 'caregiver') {
              if(greetingName) greetingName.innerText = 'Hello, Priya';
              if(roleText) roleText.innerText = 'Caregiver';
          } else if(state.role === 'family') {
              if(greetingName) greetingName.innerText = 'Hello, Family';
              if(roleText) roleText.innerText = 'Family Member';
          } else {
              if(greetingName) greetingName.innerText = 'Hello, Lakshmi';
              if(roleText) roleText.innerText = 'Patient';
          }

          const stdGrid = document.getElementById('homeGridStandard');
          const patGrid = document.getElementById('homeGridPatient');
          
          if(state.role === 'patient') {
            if(stdGrid) stdGrid.setAttribute('hidden', 'true');
            if(patGrid) patGrid.removeAttribute('hidden');
          } else {
            if(patGrid) patGrid.setAttribute('hidden', 'true');
            if(stdGrid) stdGrid.removeAttribute('hidden');
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
      if (notifList) {
        notifList.innerHTML = `
          <li>⚠️ Priya has a scheduling conflict at 3:00 PM</li>
          <li>🔔 Arun picked up Grocery pickup</li>
        `;
      }
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
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        const parent = chip.parentElement;
        parent.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        if(chip.hasAttribute('data-filter-caregiver')) {
          state.activeFilters.caregiver = chip.getAttribute('data-filter-caregiver');
        }
        if(chip.hasAttribute('data-filter-category')) {
          state.activeFilters.category = chip.getAttribute('data-filter-category');
        }
        renderScheduleTable();
      });
    });
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
      nextBtn.addEventListener('click', () => {
        state.currentWeek++;
        renderCalendar();
      });
    }
    
    if(prevBtn) {
      prevBtn.addEventListener('click', () => {
        state.currentWeek--;
        renderCalendar();
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

        // Block tasks whose date + time is already in the past (real now).
        if (isInPast(dateVal, timeRaw)) {
          setError('That date and time are already in the past. Pick a future time.');
          return;
        }

        const { error } = await createTask({
          title,
          category: cat,
          time: timeRaw || '12:00',
          date: dateVal,
          assignee: 'Unassigned',
          priority: 'medium',
          status: 'pending',
          source: 'manual'
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
    const patEmBtn = document.getElementById('patientEmergencyBtn');
    const emOverlay = document.getElementById('emergencyOverlay');
    const emClose = document.getElementById('emergencyCloseBtn');
    const emRows = document.getElementById('emergencyRows');

    const openEmergency = () => {
      if(emRows) {
        emRows.innerHTML = `
          <div class="em-row">
            <div class="em-info"><strong>Nearest Caregiver: Arun</strong><span>1.2 km away • AVAILABLE</span></div>
            <button class="btn btn-primary btn-small">Call</button>
          </div>
          <div class="em-row">
            <div class="em-info"><strong>CMC Hospital</strong><span>2.4 km away</span></div>
            <button class="btn btn-secondary btn-small">View</button>
          </div>
        `;
      }
      if(emOverlay) emOverlay.removeAttribute('hidden');
    };

    if(emBtn) emBtn.addEventListener('click', openEmergency);
    if(patEmBtn) patEmBtn.addEventListener('click', openEmergency);
    if(emClose) emClose.addEventListener('click', () => emOverlay.setAttribute('hidden', 'true'));

    const profBtn = document.getElementById('profileBtn');
    const profOverlay = document.getElementById('profileOverlay');
    const profClose = document.getElementById('profileCloseBtn');
    
    if(profBtn) profBtn.addEventListener('click', () => { if(profOverlay) profOverlay.removeAttribute('hidden'); });
    if(profClose) profClose.addEventListener('click', () => { if(profOverlay) profOverlay.setAttribute('hidden', 'true'); });
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
    const previewImg = document.getElementById('chaosImagePreview');
    const removeImageBtn = document.getElementById('removeImageBtn');
    
    const chaosEmpty = document.getElementById('chaosEmpty');
    const chaosLoading = document.getElementById('chaosLoading');
    const chaosLoadingText = document.getElementById('chaosLoadingText');
    const chaosResults = document.getElementById('chaosResults');
    const extractedList = document.getElementById('extractedList');
    const addToCalendarBtn = document.getElementById('addToCalendarBtn');

    if(imageUpload) {
      imageUpload.addEventListener('change', function() {
        const file = this.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(e) {
            if(previewImg) previewImg.src = e.target.result;
            if(previewWrap) previewWrap.removeAttribute('hidden');
          }
          reader.readAsDataURL(file);
        }
      });
    }

    if(removeImageBtn) {
      removeImageBtn.addEventListener('click', () => {
        if(imageUpload) imageUpload.value = '';
        if(previewImg) previewImg.src = '';
        if(previewWrap) previewWrap.setAttribute('hidden', 'true');
      });
    }

    // Stand-in for real extraction (see extractTask.mjs / extractFromImage.mjs).
    // Relative phrases are resolved against the real current date via new Date().
    function runExtraction() {
      const shift = (days) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return toISODate(d);
      };
      const stamp = Date.now();
      state.stagedTasks = [
        { id: `stg-${stamp}-1`, title: 'Doctor Appointment', date: shift(1), time: '15:00', assignee: 'Unassigned', category: 'appointment' },
        { id: `stg-${stamp}-2`, title: 'Grocery pickup', date: shift(-1), time: '17:00', assignee: 'Unassigned', category: 'grocery' }
      ];
      renderStagedTasks();
    }

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

      const flagged = items.filter(s => isInPast(s.date, s.time)).length;
      const ready = items.length - flagged;

      const head = document.getElementById('extractedCount');
      if (head) {
        head.textContent = flagged
          ? `${ready} ready to add · ${flagged} flagged for review`
          : 'Review pending tasks';
      }

      extractedList.innerHTML = items.map(s => {
        const past = isInPast(s.date, s.time);
        return `
          <div class="task-card staged ${past ? 'flagged' : ''}" data-stg="${s.id}">
            <span class="staged-badge">${past ? '⚠ Past date' : 'Pending Review'}</span>
            <div class="task-time">${formatDateLabel(s.date)}<br>${formatTime(s.time)}</div>
            <div class="task-details">
              <strong>${s.title}</strong>
              <div class="task-meta"><span>${s.assignee}</span></div>
            </div>
            ${past ? `
              <div class="staged-warning">This date and time have already passed — review before adding.</div>
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
      generateBtn.addEventListener('click', () => {
        const hasText = chaosInput && chaosInput.value.trim().length > 0;
        const hasImage = imageUpload && imageUpload.files.length > 0;

        if (!hasText && !hasImage) return;

        if(chaosEmpty) chaosEmpty.setAttribute('hidden', 'true');
        if(chaosResults) chaosResults.setAttribute('hidden', 'true');
        if(chaosLoading) chaosLoading.removeAttribute('hidden');

        if(chaosLoadingText) chaosLoadingText.innerText = hasImage ? 'Extracting text from image...' : 'Reading message...';

        setTimeout(() => {
          if(hasImage && chaosLoadingText) chaosLoadingText.innerText = 'Structuring care schedule...';
          setTimeout(runExtraction, 1200);
        }, hasImage ? 1200 : 0);
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
        const ready = state.stagedTasks.filter(s => !isInPast(s.date, s.time));
        if (ready.length === 0) return;

        let added = 0;
        for (const staged of ready) {
          const { error } = await addStagedTask(staged);
          if (!error) added++;
        }

        // Keep any flagged (past-dated) tasks so the user still reviews them.
        state.stagedTasks = state.stagedTasks.filter(s => isInPast(s.date, s.time));
        const stillFlagged = state.stagedTasks.length;

        if(chaosInput) chaosInput.value = '';
        if(imageUpload) imageUpload.value = '';
        if(previewImg) previewImg.src = '';
        if(previewWrap) previewWrap.setAttribute('hidden', 'true');

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
    const suggestions = document.getElementById('suggestedQuestions');

    if(chatLog) {
      chatLog.innerHTML = `<div class="chat-msg bot">Hi! I'm CareSync AI. How can I help you coordinate resources today?</div>`;
    }

    if(suggestions) {
      suggestions.innerHTML = `
        <button class="chip-btn" type="button">Elderly transport near me</button>
        <button class="chip-btn" type="button">24/7 Pharmacy</button>
      `;
      suggestions.addEventListener('click', (e) => {
        if(e.target.classList.contains('chip-btn')) {
          if(chatInput) chatInput.value = e.target.innerText;
          if(chatForm) chatForm.dispatchEvent(new Event('submit'));
        }
      });
    }

    if(chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const msg = chatInput ? chatInput.value.trim() : '';
        if (!msg) return;

        if(chatLog) chatLog.innerHTML += `<div class="chat-msg user">${msg}</div>`;
        if(chatInput) chatInput.value = '';
        if(chatLog) chatLog.scrollTop = chatLog.scrollHeight;

        setTimeout(() => {
          if(chatLog) {
            chatLog.innerHTML += `
              <div class="chat-msg bot">
                I found a great resource near you:
                <div class="resource-card">
                  <strong>🚗 ElderCare Transport</strong><br>1.2 km away • Highly relevant<br>
                  <button class="btn btn-secondary btn-small" style="margin-top:8px">Call Now</button>
                </div>
              </div>
            `;
            chatLog.scrollTop = chatLog.scrollHeight;
          }
        }, 1000);
      });
    }
  }

  function renderAll() {
    renderMembersRow();
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
      html += `<div class="member-avatar" title="${c.name}">${c.initials}</div>`;
    });
    if(row) row.innerHTML = html;
    if(schedRow) schedRow.innerHTML = html;
  }

  function renderMiniTasks() {
    const list = document.getElementById('miniTaskList');
    const patList = document.getElementById('patientTaskList');
    let html = '';
    const today = todayISO();
    const pendingTasks = state.tasks.filter(t => t.status !== 'done' && (!t.date || t.date >= today));

    pendingTasks.slice(0,3).forEach(t => {
      html += `
        <li class="task-card ${t.priority === 'high' ? 'priority-high' : ''}">
          <div class="task-time">${formatDateLabel(t.date)} ${t.time}</div>
          <div class="task-details"><strong>${t.title}</strong><div class="task-meta"><span>${t.assignee}</span></div></div>
        </li>
      `;
    });
    
    if(list) list.innerHTML = html;
    if(patList) patList.innerHTML = html;
  }

  function renderConflict() {
    const body = document.getElementById('conflictBody');
    const conflictTask = state.tasks.find(t => t.status === 'conflict');
    const chip = document.getElementById('conflictStatusChip');

    if(!body || !chip) return;

    if (conflictTask) {
      chip.className = 'status-chip danger';
      chip.innerText = 'Action Required';

      const cover = (state.caregivers[1] && state.caregivers[1].name) || getCurrentUser();
      const deadlinePassed =
        conflictTask._status === 'uncovered_urgent' ||
        isInPast(conflictTask._date, conflictTask._time);

      if (deadlinePassed) {
        body.innerHTML = `
          <p><strong>${conflictTask.title}</strong> was due ${formatDateLabel(conflictTask._date)} at ${formatTime(conflictTask._time)} and went uncovered.</p>
          <p style="color:var(--color-danger); margin-top:4px;">The deadline has passed — this task can no longer be claimed as upcoming.</p>
          <div class="ai-recommendation">
            <h3>AI Recommendation</h3>
            <p>Ask ${cover} to cover it late, or mark it handled.</p>
            <button class="btn btn-primary btn-small" id="acceptConflictBtn" style="margin-top:12px">Assign ${cover} to cover late</button>
          </div>
        `;
      } else {
        body.innerHTML = `
          <p><strong>${conflictTask.title}</strong> (${conflictTask.time}) is assigned to Priya.</p>
          <p style="color:var(--color-danger); margin-top:4px;">But Priya is already committed to: Hospital Shift (02:30 PM).</p>
          <div class="ai-recommendation">
            <h3>AI Recommendation</h3>
            <p>Assign to ${cover}. ✓ Available at ${conflictTask.time}</p>
            <button class="btn btn-primary btn-small" id="acceptConflictBtn" style="margin-top:12px">Accept Recommendation</button>
          </div>
        `;
      }

      document.getElementById('acceptConflictBtn').addEventListener('click', async () => {
        const { error } = await updateTask(conflictTask.id, { assignee: cover, status: 'pending' });
        if (error) { showToast('Could not resolve: ' + error.message); return; }
        showToast(deadlinePassed ? `${cover} assigned to cover late.` : "Conflict Resolved!");
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

    const primaryCg = state.caregivers[0] || { name: 'Priya', load: 0 };
    const secondaryName = (state.caregivers[1] && state.caregivers[1].name) || 'another caregiver';
    const priyaLoad = primaryCg.load;

    if (priyaLoad > 75) {
      warning.innerHTML = `<p style="margin-bottom:12px">AI predicts ${primaryCg.name} may become overloaded.</p>`;
      action.innerHTML = `
        <div class="ai-recommendation">
          <h3>AI Recommendation</h3>
          <p>Redistribute 2 upcoming tasks to ${secondaryName}.</p>
          <button class="btn btn-secondary btn-small" id="reviewLoadBtn" style="margin-top:8px">Accept Redistribution</button>
        </div>
      `;
      setTimeout(() => {
        const btn = document.getElementById('reviewLoadBtn');
        if(btn) btn.addEventListener('click', () => {
          if (state.caregivers[0]) state.caregivers[0].load = 60;
          if (state.caregivers[1]) state.caregivers[1].load = 76;
          showToast("Workload Redistributed!");
          renderWorkload();
        });
      }, 0);
    } else {
      warning.innerHTML = `<p style="margin-bottom:12px; color:var(--color-sage); font-weight:600;">Workload is evenly distributed.</p>`;
      action.innerHTML = '';
    }

    let barsHtml = '';
    state.caregivers.forEach(c => {
      const isHigh = c.load > 75 ? 'high' : '';
      barsHtml += `
        <div class="workload-row">
          <span class="wl-name">${c.name}</span>
          <div class="wl-bar-bg"><div class="wl-bar-fill ${isHigh}" style="width: ${c.load}%"></div></div>
          <span class="wl-val">${c.load}%</span>
        </div>
      `;
    });
    barsContainer.innerHTML = barsHtml;
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

  document.getElementById('scheduleTableBody')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-drop')) {
      const taskId = e.target.getAttribute('data-id');
      const { error } = await updateTask(taskId, { assignee: 'Unassigned', status: 'pending' });
      if (error) { showToast('Could not update task: ' + error.message); return; }
      showToast("Task marked as Unassigned.");
      await refreshTasks();
    }
    if (e.target.classList.contains('btn-claim')) {
      const taskId = e.target.getAttribute('data-id');
      const task = state.tasks.find(t => t.id === taskId);

      // Deadline already passed (real current date/time) — can't be claimed.
      if (task && isInPast(task._date, task._time)) {
        if (task._status !== 'uncovered_urgent') {
          const { error } = await updateTask(taskId, { status: 'uncovered_urgent' });
          if (error) { showToast('Could not flag task: ' + error.message); return; }
        }
        showToast(
          `Deadline passed — "${task.title}" was due ${formatDateLabel(task._date)} at ${formatTime(task._time)}. ` +
          `It can no longer be claimed and is now flagged as urgent / uncovered.`
        );
        await refreshTasks();
        return;
      }

      const me = getCurrentUser();
      const { error } = await updateTask(taskId, { assignee: me, status: 'pending' });
      if (error) { showToast('Could not claim task: ' + error.message); return; }
      showToast(`Task claimed by ${me}!`);
      await refreshTasks();
    }
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
        let assigneeHtml = t.assignee;
        let actionHtml = '';

        const deadlinePassed = isInPast(t._date, t._time);

        if (t.assignee === 'Unassigned') {
          assigneeHtml = `
            <span class="unassigned-text">Unassigned</span>
            <span class="ai-suggest">
              <svg viewBox="0 0 24 24" class="icon" style="width:12px;height:12px"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5"/></svg>
              AI Suggests: ${suggestionFor[t.id]}
            </span>
          `;
          actionHtml = deadlinePassed
            ? `<button class="btn-claim" data-id="${t.id}">Claim (deadline passed)</button>`
            : `<button class="btn-claim" data-id="${t.id}">Claim Task</button>`;
        }
        else if (t.assignee === currentUser) {
          actionHtml = `<button class="btn-drop" data-id="${t.id}">Not Available</button>`;
        }

        const noteworthy = t._status === 'uncovered_urgent' || t._status === 'handoff_requested';
        const statusLabel = (noteworthy ? t._status.replace(/_/g, ' ') : t.status).toUpperCase();
        const statusClass = (t.status === 'conflict' || deadlinePassed) ? 'danger' : 'success';

        activeHtml += `
          <tr>
            <td>${formatDateLabel(t.date)}</td>
            <td><strong>${t.time}</strong></td>
            <td>${t.title}</td>
            <td><span class="status-chip">${t.category}</span></td>
            <td>${assigneeHtml}</td>
            <td>${t.priority.toUpperCase()}</td>
            <td><span class="status-chip ${statusClass}">${statusLabel}</span></td>
            <td>${actionHtml}</td>
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
            <td class="task-done-text">${t.title}</td>
            <td><span class="status-chip done">${t.category}</span></td>
            <td><span class="task-done-text">${t.assignee}</span></td>
            <td><span class="task-done-text">${t.priority.toUpperCase()}</span></td>
            <td><span class="status-chip done">${t.status.toUpperCase()}</span></td>
            <td></td>
          </tr>
        `;
      });
      doneTbody.innerHTML = doneHtml;
    }
  }
});