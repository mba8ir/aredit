// Toggle thread collapse/expand
function toggleThread(btn) {
  var children = btn.nextElementSibling;
  if (!children || !children.classList.contains('comment-children')) return;
  var count = btn.dataset.count || '';
  var isCollapsed = children.classList.contains('collapsed');
  children.classList.toggle('collapsed');
  if (isCollapsed) {
    btn.textContent = 'إخفاء الردود (' + count + ')';
    btn.setAttribute('aria-expanded', 'true');
  } else {
    btn.textContent = 'عرض الردود (' + count + ')';
    btn.setAttribute('aria-expanded', 'false');
  }
}

// Toggle reply form
function toggleReply(commentId) {
  const form = document.getElementById('reply-form-' + commentId);
  if (form) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') {
      form.querySelector('textarea').focus();
    }
  }
}

// Toast notification system
function showToast(message, type) {
  type = type || 'success';
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() { toast.classList.add('show'); }, 10);
  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
}

// Copy link to clipboard
function copyLink(path) {
  var url = window.location.origin + path;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function() {
      showToast('تم نسخ الرابط');
    });
  } else {
    var input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('تم نسخ الرابط');
  }
}

// Bookmark toggle
function toggleBookmark(postId, btn) {
  fetch('/p/' + postId + '/bookmark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  .then(function(res) {
    if (res.status === 401) { window.location.href = '/login'; return; }
    return res.json();
  })
  .then(function(data) {
    if (!data) return;
    btn.innerHTML = data.bookmarked ? '&#128278; محفوظ' : '&#128278; حفظ';
    btn.dataset.bookmarked = data.bookmarked;
    showToast(data.bookmarked ? 'تم الحفظ' : 'تم إزالة الحفظ');
  });
}

// Report modal
function showReportModal(type, id) {
  var modal = document.getElementById('report-modal');
  if (!modal) return;
  modal.innerHTML =
    '<div class="modal-backdrop" onclick="closeReportModal()"></div>' +
    '<div class="modal-content">' +
    '<h3>إبلاغ عن ' + (type === 'post' ? 'منشور' : 'تعليق') + '</h3>' +
    '<textarea id="report-reason" rows="3" placeholder="سبب الإبلاغ..." maxlength="500"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
    '<button class="btn btn-primary" onclick="submitReport(\'' + type + '\',' + id + ')">إرسال</button>' +
    '<button class="btn btn-outline" onclick="closeReportModal()">إلغاء</button>' +
    '</div></div>';
  modal.style.display = 'flex';
}

function closeReportModal() {
  var modal = document.getElementById('report-modal');
  if (modal) modal.style.display = 'none';
}

function submitReport(type, id) {
  var reason = document.getElementById('report-reason').value.trim();
  if (!reason) { showToast('يرجى إدخال سبب الإبلاغ', 'error'); return; }

  var url = type === 'post' ? '/p/' + id + '/report' : '/comment/' + id + '/report';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason })
  })
  .then(function(res) {
    if (res.status === 401) { window.location.href = '/login'; return; }
    return res.json();
  })
  .then(function(data) {
    if (!data) return;
    closeReportModal();
    showToast(data.message);
  });
}

// Edit comment inline
function editComment(commentId) {
  var bodyEl = document.getElementById('comment-body-' + commentId);
  if (!bodyEl) return;

  var currentText = bodyEl.textContent;
  var textarea = document.createElement('textarea');
  textarea.value = currentText;
  textarea.rows = 3;
  textarea.className = 'edit-comment-textarea';
  textarea.maxLength = 10000;

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-sm';
  saveBtn.textContent = 'حفظ';

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-sm btn-outline';
  cancelBtn.textContent = 'إلغاء';
  cancelBtn.style.marginRight = '0.5rem';

  var wrapper = document.createElement('div');
  wrapper.className = 'edit-comment-wrapper';
  wrapper.appendChild(textarea);
  var btns = document.createElement('div');
  btns.style.marginTop = '0.5rem';
  btns.appendChild(saveBtn);
  btns.appendChild(cancelBtn);
  wrapper.appendChild(btns);

  bodyEl.style.display = 'none';
  bodyEl.parentNode.insertBefore(wrapper, bodyEl.nextSibling);

  textarea.focus();

  cancelBtn.onclick = function() {
    wrapper.remove();
    bodyEl.style.display = '';
  };

  saveBtn.onclick = function() {
    fetch('/comment/' + commentId + '/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: textarea.value })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        bodyEl.textContent = data.body;
        wrapper.remove();
        bodyEl.style.display = '';
        showToast('تم تعديل التعليق');
      } else {
        showToast(data.error || 'حدث خطأ', 'error');
      }
    });
  };
}

// Voting with loading state
document.addEventListener('click', async function(e) {
  const btn = e.target.closest('.vote-btn');
  if (!btn) return;

  const controls = btn.closest('.vote-controls, .comment-vote');
  if (!controls) return;

  // Prevent double-click
  if (controls.dataset.loading === 'true') return;
  controls.dataset.loading = 'true';

  const type = controls.dataset.type;
  const id = controls.dataset.id;
  const value = parseInt(btn.dataset.value);

  let url;
  if (type === 'post') {
    url = '/p/' + id + '/vote';
  } else if (type === 'comment') {
    url = '/comment/' + id + '/vote';
  } else {
    controls.dataset.loading = 'false';
    return;
  }

  // Add loading visual
  const scoreEl = controls.querySelector('.score');
  scoreEl.style.opacity = '0.5';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });

    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }

    const data = await res.json();
    if (data.score !== undefined) {
      scoreEl.textContent = data.score;

      const upBtn = controls.querySelector('.upvote');
      const downBtn = controls.querySelector('.downvote');

      if (btn.classList.contains('active')) {
        btn.classList.remove('active');
      } else {
        upBtn.classList.remove('active');
        downBtn.classList.remove('active');
        btn.classList.add('active');
      }
    }
  } catch (err) {
    console.error('Vote error:', err);
  } finally {
    scoreEl.style.opacity = '1';
    controls.dataset.loading = 'false';
  }
});
