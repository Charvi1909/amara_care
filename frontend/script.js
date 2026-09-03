document.addEventListener('DOMContentLoaded', () => {
  const state = {
    role: 'caregiver',
    activeFilters: { caregiver: 'all', category: 'all' },
    currentWeek: 0,
    selectedDate: null,
    tasks: [], 
    caregivers: [
      { name: 'Priya', load: 82, initials: 'PR' },
      { name: 'Arun', load: 54, initials: 'AR' },
      { name: 'Meera', load: 39, initials: 'MR' }
    ]
  };

  async function fetchTasks() {
    try {
      const response = await fetch('/api/tasks');
      const realTasks = await response.json();
      if(realTasks) {
          state.tasks = realTasks;
          renderAll(); 
      }
    } catch(err) {}
  }
  
  fetchTasks();

  const safeRun = (name, fn) => {
    try { fn(); } 
    catch(e) {}
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

  function getCurrentUser() {
    if(state.role === 'caregiver') return 'Priya';
    if(state.role === 'family') return 'Arun';
    return 'Meera';
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

    if(globalBtn && overlay) {
      globalBtn.addEventListener('click', () => overlay.removeAttribute('hidden'));
    }
    if(closeBtn && overlay) {
      closeBtn.addEventListener('click', () => overlay.setAttribute('hidden', 'true'));
    }

    if(form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const title = document.getElementById('newTaskTitle').value;
        const cat = document.getElementById('newTaskCategory').value;
        const timeRaw = document.getElementById('newTaskTime').value;
        const dateRaw = document.getElementById('newTaskDate').value;
        const priorityVal = document.getElementById('newTaskPriority').value;
        
        let timeStr = "12:00 PM";
        if(timeRaw) {
          let [h, m] = timeRaw.split(':');
          let ampm = h >= 12 ? 'PM' : 'AM';
          h = h % 12 || 12;
          timeStr = `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
        }
        
        let dateStr = "Today";
        if(dateRaw) {
           const d = new Date(dateRaw);
           const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
           if(d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 2) {
               dateStr = "Today"; 
           } else {
               dateStr = monthNames[d.getMonth()] + ' ' + d.getDate();
           }
        }

        state.tasks.push({
          id: Date.now(),
          date: dateStr,
          time: timeStr,
          title: title,
          category: cat,
          assignee: 'Unassigned', 
          priority: priorityVal,
          status: 'pending'
        });

        form.reset();
        overlay.setAttribute('hidden', 'true');
        
        showToast("New task added to Unassigned!");
        
        document.querySelector('.tab-btn[data-view="schedule"]').click();
        renderAll();
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

    if(generateBtn) {
      generateBtn.addEventListener('click', async () => {
        const textVal = chaosInput ? chaosInput.value.trim() : '';
        const fileVal = imageUpload && imageUpload.files.length > 0 ? imageUpload.files[0] : null;
        
        if (!textVal && !fileVal) return; 
        
        if(chaosEmpty) chaosEmpty.setAttribute('hidden', 'true');
        if(chaosResults) chaosResults.setAttribute('hidden', 'true');
        if(chaosLoading) chaosLoading.removeAttribute('hidden');
        if(chaosLoadingText) chaosLoadingText.innerText = 'Extracting AI schedule...';

        try {
          const formData = new FormData();
          if (textVal) formData.append('message', textVal);
          if (fileVal) formData.append('image', fileVal);

          const response = await fetch('/api/process-chaos', {
            method: 'POST',
            body: formData
          });

          const payload = await response.json();

          if(chaosLoading) chaosLoading.setAttribute('hidden', 'true');
          if(chaosResults) chaosResults.removeAttribute('hidden');
          
          if(extractedList && payload) {
            extractedList.innerHTML = `
              <div class="task-card staged">
                <span class="staged-badge">Pending Review</span>
                <div class="task-time">${payload.time}</div>
                <div class="task-details">
                  <strong>${payload.title}</strong>
                  <div class="task-meta"><span>${payload.assignedTo}</span></div>
                </div>
              </div>
            `;
            
            if(payload.warnings && payload.warnings.length > 0) {
               showToast(payload.warnings[0].message);
            }

            window.pendingAITask = payload;
          }
        } catch (error) {
           if(chaosLoadingText) chaosLoadingText.innerText = 'Error processing request.';
        }
      });
    }

    if(addToCalendarBtn) {
      addToCalendarBtn.addEventListener('click', () => {
        state.tasks.push({ id: Date.now(), date: 'Today', time: '05:00 PM', title: 'Pick up aunt', category: 'general', assignee: 'Unassigned', priority: 'medium', status: 'pending' });
        
        if(chaosInput) chaosInput.value = '';
        if(imageUpload) imageUpload.value = '';
        if(previewImg) previewImg.src = '';
        if(previewWrap) previewWrap.setAttribute('hidden', 'true');
        
        if(chaosResults) chaosResults.setAttribute('hidden', 'true');
        if(chaosEmpty) chaosEmpty.removeAttribute('hidden');
        
        showToast("Tasks confirmed and added to Shared Calendar!");
        document.querySelector('.tab-btn[data-view="schedule"]').click();
        renderScheduleTable();
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
    const pendingTasks = state.tasks.filter(t => t.status !== 'done');
    
    pendingTasks.slice(0,3).forEach(t => {
      html += `
        <li class="task-card ${t.priority === 'high' ? 'priority-high' : ''}">
          <div class="task-time">${t.time}</div>
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
      body.innerHTML = `
        <p><strong>${conflictTask.title}</strong> (${conflictTask.time}) is assigned to Priya.</p>
        <p style="color:var(--color-danger); margin-top:4px;">But Priya is already committed to: Hospital Shift (02:30 PM).</p>
        <div class="ai-recommendation">
          <h3>AI Recommendation</h3>
          <p>Assign to Arun. ✓ Available at 03:00 PM</p>
          <button class="btn btn-primary btn-small" id="acceptConflictBtn" style="margin-top:12px">Accept Recommendation</button>
        </div>
      `;
      document.getElementById('acceptConflictBtn').addEventListener('click', () => {
        conflictTask.assignee = 'Arun';
        conflictTask.status = 'pending';
        showToast("Conflict Resolved!");
        renderConflict();
        renderScheduleTable();
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

    const priyaLoad = state.caregivers.find(c => c.name === 'Priya').load;
    
    if (priyaLoad > 75) {
      warning.innerHTML = `<p style="margin-bottom:12px">AI predicts Priya may become overloaded.</p>`;
      action.innerHTML = `
        <div class="ai-recommendation">
          <h3>AI Recommendation</h3>
          <p>Redistribute 2 upcoming tasks to Arun.</p>
          <button class="btn btn-secondary btn-small" id="reviewLoadBtn" style="margin-top:8px">Accept Redistribution</button>
        </div>
      `;
      setTimeout(() => {
        const btn = document.getElementById('reviewLoadBtn');
        if(btn) btn.addEventListener('click', () => {
          state.caregivers.find(c => c.name === 'Priya').load = 60;
          state.caregivers.find(c => c.name === 'Arun').load = 76;
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

    let baseDate = new Date(2026, 8, 2);
    let dayOfWeek = baseDate.getDay();

    let startDate = new Date(baseDate);
    startDate.setDate(baseDate.getDate() - dayOfWeek + (state.currentWeek * 7));

    label.innerText = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    for(let i=0; i<7; i++) {
      let currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);

      let dayNum = currentDate.getDate();
      let monthNum = currentDate.getMonth();

      let dateString = '';
      if (state.currentWeek === 0 && dayNum === 2 && monthNum === 8) {
        dateString = 'Today';
      } else {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
        dateString = monthNames[monthNum] + ' ' + dayNum;
      }

      let isToday = (state.currentWeek === 0 && dayNum === 2 && monthNum === 8);
      let userHasTask = state.tasks.some(t => t.date === dateString && t.assignee === currentUser);

      let hasTaskClass = userHasTask ? 'has-task' : '';
      let activeClass = isToday ? 'active' : '';
      let selectedClass = (state.selectedDate === dateString) ? 'selected-day' : '';

      let dayDiv = document.createElement('div');
      dayDiv.className = `calendar-day ${activeClass} ${hasTaskClass} ${selectedClass}`;
      dayDiv.innerText = dayNum;

      dayDiv.addEventListener('click', () => {
        if (state.selectedDate === dateString) {
          state.selectedDate = null;
          showToast("Showing all dates");
        } else {
          state.selectedDate = dateString;
          showToast("Filtering by " + dateString);
        }
        renderCalendar();
        renderScheduleTable();
      });

      grid.appendChild(dayDiv);
    }
  }

  // --- RECURRING TASK MANAGEMENT LOGIC ---
  let activeActionTaskId = null;

  document.getElementById('scheduleTableBody')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-drop')) {
      const taskId = e.target.getAttribute('data-id');
      const task = state.tasks.find(t => t.id == taskId);
      if (task) {
        activeActionTaskId = taskId;
        const promptEl = document.getElementById('recurringTaskTitlePrompt');
        if (promptEl) promptEl.innerText = `What would you like to do with "${task.title}" on ${task.date}?`;
        const overlay = document.getElementById('recurringActionOverlay');
        if (overlay) overlay.removeAttribute('hidden');
      }
    }
    
    if (e.target.classList.contains('btn-claim')) {
      const taskId = parseInt(e.target.getAttribute('data-id'));
      const task = state.tasks.find(t => t.id === taskId);
      if(task) {
        task.assignee = getCurrentUser();
        showToast(`Task claimed by ${task.assignee}!`);
        renderScheduleTable();
        renderCalendar();
        renderMiniTasks(); 
      }
    }
  });

  document.getElementById('recurringCloseBtn')?.addEventListener('click', () => {
    document.getElementById('recurringActionOverlay')?.setAttribute('hidden', 'true');
  });

  document.getElementById('skipOnceBtn')?.addEventListener('click', async () => {
    const task = state.tasks.find(t => t.id == activeActionTaskId);
    document.getElementById('recurringActionOverlay')?.setAttribute('hidden', 'true');
    
    try {
      const res = await fetch('/api/tasks/recurring-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: activeActionTaskId,
          actionType: 'skip_once',
          targetDate: task ? task.date : 'Today'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Task skipped for this instance.");
        fetchTasks();
      }
    } catch (err) {
      showToast("Error processing skip request.");
    }
  });

  document.getElementById('confirmReassignBtn')?.addEventListener('click', async () => {
    const newAssignee = document.getElementById('reassignTargetSelect').value;
    document.getElementById('recurringActionOverlay')?.setAttribute('hidden', 'true');

    try {
      const res = await fetch('/api/tasks/recurring-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: activeActionTaskId,
          actionType: 'permanent_reassign',
          newAssignee: newAssignee
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Task permanently reassigned to ${newAssignee}!`);
        fetchTasks();
      }
    } catch (err) {
      showToast("Error processing reassignment.");
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

    if (activeTasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: #888;">No active tasks match these filters.</td></tr>`;
    } else {
      let activeHtml = '';
      activeTasks.forEach(t => {
        let assigneeHtml = t.assignee;
        let actionHtml = '';

        if (t.assignee === 'Unassigned') {
          assigneeHtml = `
            <span class="unassigned-text">Unassigned</span>
            <span class="ai-suggest">
              <svg viewBox="0 0 24 24" class="icon" style="width:12px;height:12px"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5"/></svg>
              AI Suggests: ${currentUser}
            </span>
          `;
          actionHtml = `<button class="btn-claim" data-id="${t.id}">Claim Task</button>`;
        } 
        else if (t.assignee === currentUser) {
          actionHtml = `<button class="btn-drop" data-id="${t.id}">Not Available</button>`;
        }

        activeHtml += `
          <tr>
            <td>${t.date}</td>
            <td><strong>${t.time}</strong></td>
            <td>${t.title}</td>
            <td><span class="status-chip">${t.category}</span></td>
            <td>${assigneeHtml}</td>
            <td>${t.priority.toUpperCase()}</td>
            <td><span class="status-chip ${t.status === 'conflict' ? 'danger' : 'success'}">${t.status.toUpperCase()}</span></td>
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
            <td class="task-done-text">${t.date}</td>
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