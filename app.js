(() => {
  "use strict";

  const STORAGE_KEY = "two-minute-starter-v1";
  const CIRCUMFERENCE = 2 * Math.PI * 140;
  const CAN_USE_SERVER_LLM =
    location.protocol.startsWith("http") &&
    !location.hostname.endsWith("github.io") &&
    (location.pathname === "/" || location.pathname === "/index.html");

  const REASON_LABELS = {
    "too-big": "任务太大",
    perfect: "怕做不好",
    distracted: "手机分心",
    tired: "太累",
    unmotivated: "不想开始",
  };

  const INTERVENTIONS = {
    "too-big":
      "先别管整件事。只做第一步：把需要的东西放到桌上，打开第一页。做完就停，也算开始。",
    perfect:
      "允许自己先做一个 60 分的垃圾版本。只写 3 行，不修改，不检查。",
    distracted:
      "把手机放到另一个房间，桌上只留这件事需要的东西。计时 10 分钟。",
    tired:
      "今天用恢复版：只做 5 分钟，或者只看一页。做完就休息，不追加任务。",
    unmotivated:
      "站起来喝口水，回到桌前，只做 1 分钟。1 分钟后想停就停。",
  };

  const TEMPLATES = {
    study: [
      { title: "打开教材或课件，翻到今天要学的那一页", minutes: 2 },
      { title: "用笔圈出 3 个关键词或看不懂的地方", minutes: 5 },
      { title: "合上资料，用自己的话写 3 句话", minutes: 10 },
      { title: "做 5 道题，只对答案，不纠结错题", minutes: 15 },
    ],
    write: [
      { title: "打开文档，把标题写上去", minutes: 2 },
      { title: "列 3 个要写的要点，每个不超过一行", minutes: 5 },
      { title: "只写第一段，允许写得烂", minutes: 10 },
      { title: "回头删掉 3 句废话", minutes: 5 },
    ],
    code: [
      { title: "打开项目，把程序跑起来", minutes: 2 },
      { title: "找到要改的那一个文件，只改 1 行", minutes: 5 },
      { title: "运行一次，看报错或结果", minutes: 10 },
      { title: "把这次改动记成 1 条笔记", minutes: 5 },
    ],
    job: [
      { title: "打开一个岗位页面，只读任职要求", minutes: 2 },
      { title: "从简历里挑 1 条最相关的经历", minutes: 5 },
      { title: "只改这 1 条，让它对上岗位关键词", minutes: 10 },
      { title: "导出 PDF，投出去 1 家", minutes: 5 },
    ],
    life: [
      { title: "设 5 分钟计时，只整理桌面一个角", minutes: 5 },
      { title: "扔掉 3 样不需要的东西", minutes: 5 },
      { title: "把剩下的东西放回一个固定位置", minutes: 5 },
    ],
    generic: [
      { title: "把这件事需要的东西放到桌上", minutes: 2 },
      { title: "只做最小的那一个动作，做 5 分钟", minutes: 5 },
      { title: "停下来，写下刚才卡住的地方", minutes: 2 },
      { title: "只改一个地方，再试 10 分钟", minutes: 10 },
    ],
  };

  const el = (id) => document.getElementById(id);

  function freshState() {
    return {
      tasks: [],
      sessions: [],
      reviews: [],
      activeTaskId: null,
      lastReview: null,
      timer: null,
      timerMinutes: 10,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      return { ...freshState(), ...JSON.parse(raw) };
    } catch {
      return freshState();
    }
  }

  let state = loadState();
  let currentTask = state.tasks.find((t) => t.id === state.activeTaskId) || null;
  let ticker = null;
  let toastTimer = null;
  let deferredPrompt = null;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* localStorage 不可用时，应用仍然可以在当前页面内使用 */
    }
  }

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function localDateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function dateLabel(key) {
    const today = localDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localDateKey(yesterdayDate);
    if (key === today) return "今天";
    if (key === yesterday) return "昨天";
    return key;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (ch) => (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch]
    ));
  }

  function toast(message) {
    const node = el("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("is-active", view.id === `view-${name}`);
    });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    if (name === "history") renderHistory();
    if (name === "home") renderHome();
    if (name === "review") prefillReview();
  }

  function classify(title) {
    if (/(找工作|投简历|面试|招聘|岗位|求职)/.test(title)) return "job";
    if (/(简历|论文|报告|PPT|文案|总结|方案)/.test(title)) return "write";
    if (/(代码|编程|bug|程序|开发|调试|部署|项目)/i.test(title)) return "code";
    if (/(复习|学习|考试|看书|背|课|章|题|笔记)/.test(title)) return "study";
    if (/(整理|打扫|收拾|房间|洗|扔|收纳)/.test(title)) return "life";
    return "generic";
  }

  function getTemplate(title) {
    return TEMPLATES[classify(title)].map((step) => ({ ...step }));
  }

  function cleanStepTitle(title) {
    return String(title)
      .replace(
        /^(只做(一半|第一步|1 分钟|5 分钟|30 秒)|先做一个 60 分版本|把手机放远|还是太大)[：:，,\s]*/,
        ""
      )
      .trim();
  }

  function shrinkStep(step) {
    const clean = cleanStepTitle(step.title);
    if (step.minutes <= 2) {
      return { title: "只做 30 秒：打开它，看一眼", minutes: 2 };
    }
    return {
      title: `只做一半：${clean}`,
      minutes: Math.max(2, Math.floor(step.minutes / 2)),
    };
  }

  async function createTask(title) {
    const submitBtn = el("taskForm").querySelector("button");
    submitBtn.disabled = true;
    submitBtn.textContent = "拆解中…";

    let steps = null;
    if (CAN_USE_SERVER_LLM) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4200);
        const response = await fetch("api/breakdown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.steps) && data.steps.length >= 2) {
            steps = data.steps.slice(0, 6).map((step) => ({
              title: String(step.title || "").slice(0, 140) || "先做一个小动作",
              minutes: Math.min(30, Math.max(1, Number(step.minutes) || 5)),
              done: false,
            }));
          }
        }
      } catch {
        /* 没有后端或没有 API key 时，用模板拆解 */
      }
    }

    if (!steps) {
      steps = getTemplate(title).map((step) => ({ ...step, done: false }));
    }

    steps[0].minutes = Math.min(steps[0].minutes, 2);

    const task = {
      id: uid(),
      title,
      baseSteps: steps.map((step) => ({ ...step })),
      steps,
      activeStep: 0,
      reason: null,
      createdAt: Date.now(),
      status: "active",
    };

    state.tasks.unshift(task);
    state.activeTaskId = task.id;
    currentTask = task;
    save();

    submitBtn.disabled = false;
    submitBtn.textContent = "拆开它";
    el("taskInput").value = "";
    renderHome();
    openBreakdown(task);
  }

  function openBreakdown(task) {
    currentTask = task;
    renderBreakdown();
    showView("breakdown");
  }

  function renderBreakdown() {
    if (!currentTask) return;
    el("bdTitle").textContent = currentTask.title;

    document.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("is-selected", chip.dataset.reason === currentTask.reason);
    });

    const intervention = el("intervention");
    if (currentTask.reason) {
      intervention.classList.remove("hidden");
      el("interventionText").textContent = INTERVENTIONS[currentTask.reason];
    } else {
      intervention.classList.add("hidden");
    }

    el("stepsList").innerHTML = currentTask.steps
      .map(
        (step) => `
        <li class="step">
          <span class="step-title">${escapeHTML(step.title)}</span>
          <span class="step-time">${step.minutes} 分钟</span>
        </li>`
      )
      .join("");

    el("startFirstFromBreakdown").textContent = `就做第一步 · ${state.timerMinutes} 分钟`;
    el("adjustTimer").textContent =
      state.timerMinutes === 10 ? "10 分钟太久，换 5 分钟" : "换回 10 分钟";
  }

  function chooseReason(reason) {
    if (!currentTask) return;
    currentTask.reason = reason;
    const baseFirst = currentTask.baseSteps[0] || { title: "先做一个小动作", minutes: 2 };
    const clean = cleanStepTitle(baseFirst.title);

    const variants = {
      "too-big": { title: `只做第一步：${clean}`, minutes: 2 },
      perfect: { title: `先做一个 60 分版本：${clean}`, minutes: 5 },
      distracted: { title: `把手机放远，${clean}`, minutes: 5 },
      tired: { title: `只做 5 分钟：${clean}`, minutes: 5 },
      unmotivated: { title: `只做 1 分钟：${clean}`, minutes: 1 },
    };

    currentTask.steps = currentTask.baseSteps.map((step) => ({ ...step, done: false }));
    currentTask.steps[0] = { ...currentTask.steps[0], ...variants[reason] };
    currentTask.activeStep = 0;
    save();
    renderBreakdown();
  }

  function renderHome() {
    const active = state.tasks.find(
      (task) => task.id === state.activeTaskId && task.status === "active"
    );

    const activeCard = el("activeTask");
    if (active && active.steps[active.activeStep]) {
      currentTask = active;
      activeCard.classList.remove("hidden");
      el("activeTaskTitle").textContent = active.title;
      const step = active.steps[active.activeStep];
      el("activeStepTitle").textContent = step.title;
      el("activeStepTime").textContent = `${step.minutes} 分钟`;
      el("startFirst").textContent = `开始 ${state.timerMinutes} 分钟`;
    } else {
      activeCard.classList.add("hidden");
    }

    const today = localDateKey();
    const todayCount = state.sessions.filter(
      (session) => localDateKey(new Date(session.createdAt)) === today
    ).length;
    el("todayStat").textContent = `今天启动 ${todayCount} 次`;

    renderWeekChart();

    const note = el("tomorrowNote");
    if (state.lastReview && state.lastReview.tomorrow) {
      note.textContent = `上次留给自己的第一步：${state.lastReview.tomorrow}`;
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }

    renderReasonBars();
  }

  function renderReasonBars() {
    const container = el("reasonBars");
    const counts = {};
    state.sessions.forEach((session) => {
      if (session.reason) {
        counts[session.reason] = (counts[session.reason] || 0) + 1;
      }
    });

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      container.innerHTML = '<p class="muted">还没有记录。先启动一次。</p>';
      return;
    }

    const max = entries[0][1];
    container.innerHTML = entries
      .map(
        ([key, count]) => `
        <div class="reason-row">
          <span>${escapeHTML(REASON_LABELS[key] || key)}</span>
          <span class="reason-track"><span class="reason-fill" style="width:${Math.round(
            (count / max) * 100
          )}%"></span></span>
          <span class="count">${count}</span>
        </div>`
      )
      .join("");
  }

  function renderWeekChart() {
    const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const days = [];
    const now = new Date();

    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({
        key: localDateKey(date),
        label: labels[date.getDay()],
        isToday: i === 0,
        count: 0,
        seconds: 0,
      });
    }

    const byKey = new Map(days.map((day) => [day.key, day]));
    state.sessions.forEach((session) => {
      const key = localDateKey(new Date(session.createdAt));
      const day = byKey.get(key);
      if (!day) return;
      day.count += 1;
      day.seconds += session.actualSeconds;
    });

    const totalCount = days.reduce((sum, day) => sum + day.count, 0);
    const totalSeconds = days.reduce((sum, day) => sum + day.seconds, 0);
    el("weekCount").textContent = `${totalCount} 次启动`;
    el("weekMinutes").textContent = String(Math.round(totalSeconds / 60));

    const max = Math.max(1, ...days.map((day) => day.count));
    el("weekChart").innerHTML = days
      .map((day) => {
        const height = day.count ? Math.max(6, Math.round((day.count / max) * 100)) : 2;
        return `
          <div class="day ${day.isToday ? "is-today" : ""}" title="${day.key}：${day.count} 次">
            <div class="day-bar-wrap"><div class="day-bar" style="height:${height}%"></div></div>
            <div class="day-count">${day.count}</div>
            <div class="day-label">${day.label}</div>
          </div>`;
      })
      .join("");
  }

  function startTimer(minutes, stepIndex) {
    const task = currentTask || state.tasks.find((item) => item.id === state.activeTaskId);
    if (!task) {
      toast("先写一件要开始的事。");
      return;
    }

    currentTask = task;
    let index = Number.isInteger(stepIndex) ? stepIndex : task.activeStep;
    if (!task.steps[index] || task.steps[index].done) {
      index = task.steps.findIndex((step) => !step.done);
    }
    if (index === -1) {
      toast("这件事已经做完了。");
      return;
    }

    const total = Math.max(1, Number(minutes) || 10) * 60;
    state.timer = {
      taskId: task.id,
      stepIndex: index,
      minutes: Math.max(1, Number(minutes) || 10),
      total,
      endAt: Date.now() + total * 1000,
    };
    save();

    el("timerStep").textContent = task.steps[index].title;
    el("timerHint").textContent = "";
    updateDial(total, total);
    showView("timer");
    startTicker();
  }

  function startTicker() {
    clearInterval(ticker);
    tick();
    ticker = setInterval(tick, 250);
  }

  function tick() {
    const timer = state.timer;
    if (!timer) return;
    const remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    updateDial(remaining, timer.total);
    if (remaining <= 0) {
      finishTimer(true, "time");
    }
  }

  function updateDial(remaining, total) {
    const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
    const seconds = String(remaining % 60).padStart(2, "0");
    el("timerTime").textContent = `${minutes}:${seconds}`;
    const progressCircle = el("dialProgress");
    progressCircle.style.strokeDasharray = String(CIRCUMFERENCE);
    progressCircle.style.strokeDashoffset = String(
      CIRCUMFERENCE * (1 - (total ? remaining / total : 0))
    );
  }

  function logSession(task, step, timer, completed, actualSeconds) {
    state.sessions.unshift({
      id: uid(),
      taskId: task.id,
      taskTitle: task.title,
      stepTitle: step ? step.title : "",
      minutes: timer.minutes,
      actualSeconds,
      completed,
      reason: task.reason || null,
      createdAt: Date.now(),
    });
  }

  function finishTimer(completed, mode) {
    const timer = state.timer;
    if (!timer) return;
    clearInterval(ticker);
    ticker = null;

    const task = state.tasks.find((item) => item.id === timer.taskId);
    if (!task) {
      state.timer = null;
      save();
      return;
    }

    const step = task.steps[timer.stepIndex];
    const elapsed = Math.min(
      timer.total,
      Math.max(
        0,
        Math.round((Date.now() - (timer.endAt - timer.total * 1000)) / 1000)
      )
    );

    logSession(task, step, timer, completed, elapsed);

    if (completed) {
      if (step) step.done = true;
      let next = task.steps.findIndex((item, index) => index > timer.stepIndex && !item.done);
      if (next === -1) next = task.steps.findIndex((item) => !item.done);
      if (next === -1) {
        task.status = "done";
        task.activeStep = Math.max(0, task.steps.length - 1);
      } else {
        task.activeStep = next;
      }
    }

    state.timer = null;
    currentTask = task;
    save();
    renderHome();

    if (completed) {
      renderDone(task);
      showView("done");
    } else {
      showView("home");
      toast(
        mode === "pause"
          ? "先停一下也算一次启动。"
          : "没关系，记下来了。"
      );
    }
  }

  function renderDone(task) {
    const text = el("doneText");
    const again = el("againBtn");
    const five = el("fiveMoreBtn");

    if (task.status === "done") {
      text.textContent = `“${task.title}”今天推进完了。剩下的时间，去休息。`;
      again.style.display = "none";
      five.style.display = "none";
      return;
    }

    again.style.display = "";
    five.style.display = "";
    const nextStep = task.steps[task.activeStep];
    text.textContent = nextStep ? `下一步：${nextStep.title}` : "这件事今天推进完了。";
  }

  function handleStuck() {
    const timer = state.timer;
    if (!timer) return;
    const task = state.tasks.find((item) => item.id === timer.taskId);
    if (!task) return;
    const step = task.steps[timer.stepIndex];
    if (!step) return;

    const smaller = shrinkStep(step);
    task.steps[timer.stepIndex] = { ...step, ...smaller, done: false };

    const total = 5 * 60;
    state.timer = {
      ...timer,
      minutes: 5,
      total,
      endAt: Date.now() + total * 1000,
    };
    save();

    el("timerStep").textContent = smaller.title;
    el("timerHint").textContent = "我们把这一步砍了一半，重新来 5 分钟。";
    updateDial(total, total);
    startTicker();
    toast("步骤已缩小，重新开始。");
  }

  function pauseTimer() {
    finishTimer(false, "pause");
  }

  function prefillReview() {
    const last = state.sessions[0];
    el("reviewTask").value =
      (currentTask && currentTask.title) || (last && last.taskTitle) || "";
    el("reviewHard").value =
      last && last.reason ? REASON_LABELS[last.reason] || "" : "";
    el("reviewNext").value =
      currentTask && currentTask.status !== "done" && currentTask.steps[currentTask.activeStep]
        ? currentTask.steps[currentTask.activeStep].title
        : (state.lastReview && state.lastReview.tomorrow) || "";
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(seconds));
    if (value < 60) return `${value} 秒`;
    return `${Math.round(value / 60)} 分钟`;
  }

  function renderHistory() {
    const list = el("historyList");
    if (!state.sessions.length) {
      list.innerHTML = '<p class="muted">还没有启动记录。回首页，做两分钟。</p>';
      return;
    }

    const groups = new Map();
    state.sessions.forEach((session) => {
      const key = localDateKey(new Date(session.createdAt));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    });

    list.innerHTML = Array.from(groups.entries())
      .map(
        ([key, sessions]) => `
        <div class="history-group">
          <h3>${dateLabel(key)}</h3>
          ${sessions
            .map(
              (session) => `
            <div class="history-item">
              <div>
                <div class="title">${escapeHTML(session.taskTitle)}</div>
                <div class="meta">${escapeHTML(session.stepTitle)}</div>
              </div>
              <div class="right">${formatDuration(session.actualSeconds)} · ${
                session.completed ? "完成" : "先停"
              }</div>
            </div>`
            )
            .join("")}
        </div>`
      )
      .join("");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `two-minute-${localDateKey()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetAll() {
    if (!confirm("清空所有记录？这个操作不能撤销。")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = freshState();
    currentTask = null;
    clearInterval(ticker);
    ticker = null;
    save();
    renderHome();
    showView("home");
    toast("已清空。");
  }

  function resumeTimerOnLoad() {
    const timer = state.timer;
    if (!timer) return false;
    if (timer.endAt <= Date.now()) {
      state.timer = null;
      save();
      return false;
    }
    const task = state.tasks.find((item) => item.id === timer.taskId);
    if (!task || !task.steps[timer.stepIndex]) {
      state.timer = null;
      save();
      return false;
    }
    currentTask = task;
    el("timerStep").textContent = task.steps[timer.stepIndex].title;
    el("timerHint").textContent = "";
    showView("timer");
    startTicker();
    return true;
  }

  function buildTicks() {
    const group = el("ticks");
    const ns = "http://www.w3.org/2000/svg";
    for (let i = 0; i < 60; i += 1) {
      const line = document.createElementNS(ns, "line");
      const long = i % 5 === 0;
      line.setAttribute("x1", "160");
      line.setAttribute("y1", long ? "18" : "24");
      line.setAttribute("x2", "160");
      line.setAttribute("y2", "32");
      line.setAttribute("transform", `rotate(${i * 6} 160 160)`);
      line.setAttribute("stroke", long ? "rgba(242,239,230,.32)" : "rgba(242,239,230,.14)");
      line.setAttribute("stroke-width", long ? "1.6" : "1");
      group.appendChild(line);
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        showView(node.dataset.view);
      });
    });

    el("taskForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = el("taskInput").value.trim();
      if (!title) {
        toast("先写一件你正在拖的事。");
        el("taskInput").focus();
        return;
      }
      await createTask(title);
    });

    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => chooseReason(chip.dataset.reason));
    });

    el("shrinkAgain").addEventListener("click", () => {
      if (!currentTask) return;
      currentTask.steps[0] = {
        ...currentTask.steps[0],
        ...shrinkStep(currentTask.steps[0]),
      };
      save();
      renderBreakdown();
      toast("再砍一半。只做最小的那个动作。");
    });

    el("startFirst").addEventListener("click", () => startTimer(state.timerMinutes));
    el("shrinkFirst").addEventListener("click", () => {
      if (!currentTask) return;
      currentTask.steps[currentTask.activeStep] = {
        ...currentTask.steps[currentTask.activeStep],
        ...shrinkStep(currentTask.steps[currentTask.activeStep]),
      };
      save();
      renderHome();
      toast("步骤已缩小。再试一次。");
    });

    el("clearTask").addEventListener("click", () => {
      if (!currentTask) return;
      if (!confirm("换一件？当前这件会留在记录里。")) return;
      currentTask.status = "paused";
      state.activeTaskId = null;
      currentTask = null;
      save();
      renderHome();
      toast("换一件。先做两分钟。");
    });

    el("startFirstFromBreakdown").addEventListener("click", () =>
      startTimer(state.timerMinutes, 0)
    );

    el("adjustTimer").addEventListener("click", () => {
      state.timerMinutes = state.timerMinutes === 10 ? 5 : 10;
      save();
      renderBreakdown();
      renderHome();
    });

    el("stuckBtn").addEventListener("click", handleStuck);
    el("doneBtn").addEventListener("click", () => finishTimer(true, "done"));
    el("pauseBtn").addEventListener("click", pauseTimer);

    el("againBtn").addEventListener("click", () => startTimer(10));
    el("fiveMoreBtn").addEventListener("click", () => startTimer(5));
    el("doneToReview").addEventListener("click", () => showView("review"));

    el("reviewForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const task = el("reviewTask").value.trim();
      const hardest = el("reviewHard").value.trim();
      const tomorrow = el("reviewNext").value.trim();
      if (!tomorrow) {
        toast("明天只做哪一步？写一句就行。");
        el("reviewNext").focus();
        return;
      }
      const review = {
        date: localDateKey(),
        task: task || "今天启动的一件事",
        hardest: hardest || "没写",
        tomorrow,
        createdAt: Date.now(),
      };
      state.reviews.unshift(review);
      state.lastReview = review;
      save();
      renderHome();
      showView("home");
      toast("记下了。明天只做这一步。");
    });

    el("exportBtn").addEventListener("click", exportData);
    el("resetBtn").addEventListener("click", resetAll);

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event;
      el("installBtn").classList.remove("hidden");
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      el("installBtn").classList.add("hidden");
      toast("已安装到桌面。");
    });

    el("installBtn").addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      el("installBtn").classList.add("hidden");
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.timer) tick();
    });
  }

  buildTicks();
  bindEvents();
  renderHome();
  if (!resumeTimerOnLoad()) showView("home");

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
