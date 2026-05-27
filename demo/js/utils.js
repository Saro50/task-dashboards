/**
 * 共享工具函数
 */

const Utils = (() => {
  // ====================
  // DOM 操作
  // ====================

  /**
   * 获取 DOM 元素（简写）
   * @param {string} selector
   * @param {Element} [parent=document]
   * @returns {Element|null}
   */
  function $(selector, parent = document) {
    return parent.querySelector(selector);
  }

  /**
   * 获取多个 DOM 元素
   * @param {string} selector
   * @param {Element} [parent=document]
   * @returns {Element[]}
   */
  function $$(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
  }

  /**
   * 创建 DOM 元素
   * @param {string} tag - 标签名
   * @param {Object} [attrs] - 属性对象
   * @param {string|Element|Array} [children] - 子内容
   * @returns {Element}
   */
  function createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);

    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.entries(value).forEach(([k, v]) => {
          el.dataset[k] = v;
        });
      } else {
        el.setAttribute(key, value);
      }
    });

    const childList = Array.isArray(children) ? children : [children];
    childList.forEach((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Element) {
        el.appendChild(child);
      }
    });

    return el;
  }

  // ====================
  // 日期与时间
  // ====================

  /**
   * 格式化日期
   * @param {Date|string|number} date
   * @param {string} [format='YYYY-MM-DD HH:mm']
   * @returns {string}
   */
  function formatDate(date, format = 'YYYY-MM-DD HH:mm') {
    const d = new Date(date);
    const map = {
      YYYY: d.getFullYear(),
      MM: String(d.getMonth() + 1).padStart(2, '0'),
      DD: String(d.getDate()).padStart(2, '0'),
      HH: String(d.getHours()).padStart(2, '0'),
      mm: String(d.getMinutes()).padStart(2, '0'),
      ss: String(d.getSeconds()).padStart(2, '0'),
    };

    let result = format;
    Object.entries(map).forEach(([key, value]) => {
      result = result.replace(key, value);
    });
    return result;
  }

  /**
   * 获取相对时间描述
   * @param {Date|string|number} date
   * @returns {string}
   */
  function relativeTime(date) {
    const now = Date.now();
    const target = new Date(date).getTime();
    const diff = now - target;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return formatDate(date);
  }

  // ====================
  // 字符串工具
  // ====================

  /**
   * 生成唯一 ID
   * @param {string} [prefix='id']
   * @returns {string}
   */
  function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 截断文本
   * @param {string} text
   * @param {number} [maxLength=100]
   * @param {string} [suffix='...']
   * @returns {string}
   */
  function truncate(text, maxLength = 100, suffix = '...') {
    if (!text || text.length <= maxLength) return text || '';
    return text.slice(0, maxLength) + suffix;
  }

  /**
   * 简易 Markdown 转 HTML
   * 支持：加粗、斜体、行内代码、标题、列表
   * @param {string} md
   * @returns {string}
   */
  function markdownToHtml(md) {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 标题
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // 加粗 & 斜体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 无序列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // 段落（双换行）
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // 清理空段落
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  // ====================
  // Toast 通知
  // ====================

  let toastContainer = null;

  /**
   * 确保 Toast 容器存在
   */
  function ensureToastContainer() {
    if (!toastContainer) {
      toastContainer = createElement('div', { className: 'toast-container' });
      document.body.appendChild(toastContainer);
    }
  }

  /**
   * 显示 Toast 通知
   * @param {string} message - 通知内容
   * @param {'info'|'success'|'error'} [type='info'] - 通知类型
   * @param {number} [duration=3000] - 持续时间 (ms)
   */
  function showToast(message, type = 'info', duration = 3000) {
    ensureToastContainer();

    const icons = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
    };

    const toast = createElement('div', {
      className: `toast toast--${type}`,
    }, [
      createElement('span', {}, icons[type] || ''),
      createElement('span', {}, message),
    ]);

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ====================
  // 模态框
  // ====================

  /**
   * 打开模态框
   * @param {Object} options
   * @param {string} options.title - 标题
   * @param {string|Element} options.content - 内容
   * @param {Array} [options.actions] - 底部按钮
   */
  function openModal({ title, content, actions = [] }) {
    // 移除已有模态框
    closeModal();

    const overlay = createElement('div', { className: 'modal-overlay' });
    const modal = createElement('div', { className: 'modal' });

    // Header
    const header = createElement('div', { className: 'modal__header' }, [
      createElement('h3', { className: 'modal__title' }, title),
      createElement('button', {
        className: 'modal__close',
        onClick: closeModal,
      }, '✕'),
    ]);

    // Body
    const body = createElement('div', { className: 'modal__body' });
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof Element) {
      body.appendChild(content);
    }

    modal.appendChild(header);
    modal.appendChild(body);

    // Footer
    if (actions.length > 0) {
      const footer = createElement('div', { className: 'modal__footer' });
      actions.forEach(({ label, type = 'secondary', onClick }) => {
        const btn = createElement('button', {
          className: `btn btn--${type}`,
          onClick: () => {
            if (onClick) onClick();
            closeModal();
          },
        }, label);
        footer.appendChild(btn);
      });
      modal.appendChild(footer);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 动画触发
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--active');
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // ESC 关闭
    overlay._escHandler = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', overlay._escHandler);
  }

  /**
   * 关闭模态框
   */
  function closeModal() {
    const overlay = document.querySelector('.modal-overlay');
    if (!overlay) return;

    overlay.classList.remove('modal-overlay--active');
    if (overlay._escHandler) {
      document.removeEventListener('keydown', overlay._escHandler);
    }
    setTimeout(() => overlay.remove(), 300);
  }

  // ====================
  // 本地存储
  // ====================

  /**
   * 存储数据到 localStorage
   * @param {string} key
   * @param {*} value
   */
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage set failed:', e);
    }
  }

  /**
   * 从 localStorage 读取数据
   * @param {string} key
   * @param {*} [defaultValue=null]
   * @returns {*}
   */
  function storageGet(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.warn('Storage get failed:', e);
      return defaultValue;
    }
  }

  /**
   * 删除 localStorage 数据
   * @param {string} key
   */
  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('Storage remove failed:', e);
    }
  }

  // ====================
  // 其他
  // ====================

  /**
   * 防抖函数
   * @param {Function} fn
   * @param {number} [delay=300]
   * @returns {Function}
   */
  function debounce(fn, delay = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * 节流函数
   * @param {Function} fn
   * @param {number} [interval=300]
   * @returns {Function}
   */
  function throttle(fn, interval = 300) {
    let lastTime = 0;
    return function (...args) {
      const now = Date.now();
      if (now - lastTime >= interval) {
        lastTime = now;
        fn.apply(this, args);
      }
    };
  }

  /**
   * 复制文本到剪贴板
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制到剪贴板', 'success');
      return true;
    } catch (e) {
      // fallback
      const textarea = createElement('textarea', {
        style: {
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
        },
      }, text);
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      textarea.remove();
      if (success) showToast('已复制到剪贴板', 'success');
      else showToast('复制失败', 'error');
      return success;
    }
  }

  /**
   * 延时等待
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ====================
  // 多项目管理
  // ====================

  const PROJECTS_KEY = 'demo_projects';
  const CURRENT_KEY = 'demo_current_project';

  function getAllProjects() {
    return storageGet(PROJECTS_KEY) || [];
  }

  function saveAllProjects(projects) {
    storageSet(PROJECTS_KEY, projects);
  }

  function getProjectById(id) {
    return getAllProjects().find(function(p) { return p.id === id; }) || null;
  }

  function saveProject(project) {
    var projects = getAllProjects();
    var idx = projects.findIndex(function(p) { return p.id === project.id; });
    if (idx >= 0) { projects[idx] = project; }
    else { projects.push(project); }
    saveAllProjects(projects);
  }

  function deleteProjectById(id) {
    var projects = getAllProjects().filter(function(p) { return p.id !== id; });
    saveAllProjects(projects);
    if (getCurrentProjectId() === id) { storageRemove(CURRENT_KEY); }
  }

  function getCurrentProjectId() {
    return storageGet(CURRENT_KEY) || null;
  }

  function setCurrentProjectId(id) {
    storageSet(CURRENT_KEY, id);
  }

  // ====================
  // 公开 API
  // ====================

  return {
    $,
    $$,
    createElement,
    formatDate,
    relativeTime,
    generateId,
    truncate,
    markdownToHtml,
    showToast,
    openModal,
    closeModal,
    storageSet,
    storageGet,
    storageRemove,
    debounce,
    throttle,
    copyToClipboard,
    sleep,
    getAllProjects,
    saveAllProjects,
    getProjectById,
    saveProject,
    deleteProjectById,
    getCurrentProjectId,
    setCurrentProjectId,
  };
})();

// 支持模块化引入
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
