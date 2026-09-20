/* =========================================================
   ระบบจัดการตู้จำหน่ายสินค้าอัตโนมัติ - script.js
   ใช้ร่วมกับ index.html, style.css และ SheetJS (xlsx) 0.18.5
   ========================================================= */
'use strict';

/* =========================================================
   1. ค่าคงที่ และกฎการทำงาน
   ========================================================= */
const STORAGE_KEY = 'vendingManagementSystem.v1';
const MAX_PER_SLOT = 4;
const COIN_DENOMS = [1, 5, 10];
const COIN_CAPACITY = { 1: 100, 5: 100, 10: 60 };

const H = {
    id: 'Master Product ID',
    name: 'ชื่อสินค้า',
    nameEn: 'ชื่อสินค้า EN',
    spiralType: 'ประเภท Spiral',
    spiralSize: 'ขนาด Spiral',
    beltColor: 'สีสายพาน',
    barcode: 'Barcode',
    category: 'หมวดหมู่',
    allowSale: 'อนุญาตขาย',
    status: 'สถานะ',
    gp: '%GP',
    startDate: 'วันที่เริ่มจำหน่าย'
};

const PRODUCT_HEADERS = [
    H.id,
    H.name,
    H.nameEn,
    H.spiralType,
    H.spiralSize,
    H.beltColor,
    H.barcode,
    H.category,
    H.allowSale,
    H.status,
    H.gp,
    H.startDate
];

const HEADER_ALIASES = {};
HEADER_ALIASES[H.id] = ['masterproductid', 'productid', 'id', 'รหัสสินค้า'];
HEADER_ALIASES[H.name] = ['ชื่อสินค้า', 'name', 'productname'];
HEADER_ALIASES[H.nameEn] = ['ชื่อสินค้าen', 'nameen', 'productnameen'];
HEADER_ALIASES[H.spiralType] = ['ประเภทspiral', 'spiraltype'];
HEADER_ALIASES[H.spiralSize] = ['ขนาดspiral', 'spiralsize'];
HEADER_ALIASES[H.beltColor] = ['สีสายพาน', 'beltcolor'];
HEADER_ALIASES[H.barcode] = ['barcode'];
HEADER_ALIASES[H.category] = ['หมวดหมู่', 'category'];
HEADER_ALIASES[H.allowSale] = ['อนุญาตขาย', 'allowsale'];
HEADER_ALIASES[H.status] = ['สถานะ', 'status'];
HEADER_ALIASES[H.gp] = ['%gp', 'gp', 'gppercent'];
HEADER_ALIASES[H.startDate] = ['วันที่เริ่มจำหน่าย', 'startdate', 'launchdate'];

const NOTIFY_TYPES = {
    info: { cls: '', icon: 'fa-circle-info', duration: 4500 },
    success: { cls: 'is-success', icon: 'fa-circle-check', duration: 4500 },
    warning: { cls: 'is-warning', icon: 'fa-triangle-exclamation', duration: 7000 },
    error: { cls: 'is-error', icon: 'fa-circle-xmark', duration: 9000 }
};

/* =========================================================
   2. State
   ========================================================= */
const state = {
    products: [],
    pma: [],
    machine: { code: '', province: '', district: '', gm: '', zone: '' },
    status: {
        online: '',
        stock: '',
        scanner: '',
        temperature: '',
        banknote: '',
        lift: '',
        door: '',
        productDoor: ''
    },
    coins: { 1: null, 5: null, 10: null },
    slots: [],
    lastUpdated: ''
};

const els = {};
let pmaIndex = { byPma: new Map(), byNo: new Map() };
let notifyTimer = null;
let searchTimer = null;
let modalResolver = null;
let modalLastFocus = null;
let storageWarned = false;

const ALIAS_LOOKUP = buildAliasLookup();

/* =========================================================
   3. ฟังก์ชันช่วยทั่วไป
   ========================================================= */
function normalizeKey(value) {
    return String(value === null || value === undefined ? '' : value)
        .toLowerCase()
        .replace(/[\s_\-\.]/g, '');
}

function buildAliasLookup() {
    const lookup = {};
    PRODUCT_HEADERS.forEach(function (header) {
        lookup[normalizeKey(header)] = header;
        (HEADER_ALIASES[header] || []).forEach(function (alias) {
            lookup[normalizeKey(alias)] = header;
        });
    });
    return lookup;
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatDateYmd(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function todayYmd() {
    return formatDateYmd(new Date());
}

function formatDateTimeThai(isoString) {
    if (!isoString) {
        return '-';
    }
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
        return '-';
    }
    return date.toLocaleString('th-TH-u-ca-gregory', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function shortenText(text, limit) {
    const chars = Array.from(String(text || ''));
    if (chars.length <= limit) {
        return chars.join('');
    }
    return chars.slice(0, limit).join('') + '…';
}

function decodeText(buffer) {
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (err) {
        try {
            text = new TextDecoder('windows-874').decode(buffer);
        } catch (err2) {
            text = new TextDecoder('utf-8').decode(buffer);
        }
    }
    if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
    }
    return text;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
        URL.revokeObjectURL(url);
    }, 1500);
}

/* =========================================================
   4. Notification Bar
   ========================================================= */
function showNotification(message, type, duration) {
    const cfg = NOTIFY_TYPES[type] || NOTIFY_TYPES.info;
    els.notificationBar.classList.remove('is-success', 'is-warning', 'is-error');
    if (cfg.cls) {
        els.notificationBar.classList.add(cfg.cls);
    }
    els.notificationIcon.className = 'fa-solid ' + cfg.icon + ' notification-icon';
    els.notificationMessage.textContent = message;
    els.notificationBar.hidden = false;
    clearTimeout(notifyTimer);
    const ms = duration === undefined ? cfg.duration : duration;
    if (ms > 0) {
        notifyTimer = setTimeout(hideNotification, ms);
    }
}

function hideNotification() {
    clearTimeout(notifyTimer);
    els.notificationBar.hidden = true;
}

/* =========================================================
   5. Modal ยืนยัน
   ========================================================= */
function confirmAction(options) {
    const opts = options || {};
    els.modalTitle.textContent = opts.title || 'ยืนยันการทำรายการ';
    els.modalMessage.textContent = opts.message || 'คุณต้องการดำเนินการต่อหรือไม่?';
    els.modalConfirm.textContent = opts.confirmText || 'ยืนยัน';
    els.modalCancel.textContent = opts.cancelText || 'ยกเลิก';
    modalLastFocus = document.activeElement;
    els.modal.hidden = false;
    els.modalConfirm.focus();
    return new Promise(function (resolve) {
        modalResolver = resolve;
    });
}

function closeModal(result) {
    if (!modalResolver) {
        return;
    }
    const resolver = modalResolver;
    modalResolver = null;
    els.modal.hidden = true;
    if (modalLastFocus && typeof modalLastFocus.focus === 'function') {
        modalLastFocus.focus();
    }
    resolver(result);
}

function handleModalKeydown(event) {
    if (els.modal.hidden) {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeModal(false);
        return;
    }
    if (event.key === 'Tab') {
        const first = els.modalCancel;
        const last = els.modalConfirm;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
}

/* =========================================================
   6. บันทึก / โหลดข้อมูลในเบราว์เซอร์ (localStorage)
   ========================================================= */
function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        if (!storageWarned) {
            storageWarned = true;
            showNotification('ไม่สามารถบันทึกข้อมูลไว้ในเบราว์เซอร์ได้ ข้อมูลจะหายเมื่อปิดหน้านี้', 'warning');
        }
    }
}

function loadState() {
    let saved = null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return;
        }
        saved = JSON.parse(raw);
    } catch (err) {
        return;
    }
    if (!saved || typeof saved !== 'object') {
        return;
    }
    if (Array.isArray(saved.products)) {
        state.products = saved.products;
    }
    if (Array.isArray(saved.pma)) {
        state.pma = saved.pma;
    }
    if (saved.machine && typeof saved.machine === 'object') {
        Object.assign(state.machine, saved.machine);
    }
    if (saved.status && typeof saved.status === 'object') {
        Object.assign(state.status, saved.status);
    }
    if (saved.coins && typeof saved.coins === 'object') {
        state.coins = Object.assign({ 1: null, 5: null, 10: null }, saved.coins);
    }
    if (Array.isArray(saved.slots)) {
        state.slots = saved.slots;
    }
    if (typeof saved.lastUpdated === 'string') {
        state.lastUpdated = saved.lastUpdated;
    }
}

/* =========================================================
   7. กฎการคำนวณ (เหรียญ / สินค้า)
   ========================================================= */
function calcCoinRefill(denom, remaining) {
    const capacity = COIN_CAPACITY[denom];
    if (remaining === null || remaining === undefined || isNaN(Number(remaining))) {
        return { capacity: capacity, remaining: null, refill: null, percent: 0 };
    }
    const count = Number(remaining);
    const refill = count >= capacity ? 0 : capacity - count;
    const percent = Math.max(0, Math.min(100, Math.round((count / capacity) * 100)));
    return { capacity: capacity, remaining: count, refill: refill, percent: percent };
}

function calcSlotRefill(slot) {
    const raw = slot.stock;
    const hasStock = raw !== null && raw !== undefined && !isNaN(Number(raw));
    const effective = hasStock && Number(raw) > 0 ? Number(raw) : 0;
    const need = effective < MAX_PER_SLOT ? MAX_PER_SLOT - effective : 0;
    let level = 'empty';
    if (effective >= MAX_PER_SLOT) {
        level = 'full';
    } else if (effective >= 2) {
        level = 'medium';
    } else if (effective === 1) {
        level = 'low';
    }
    return { raw: hasStock ? Number(raw) : null, effective: effective, need: need, level: level };
}

function buildSlotLabel(ids) {
    if (!ids || !ids.length) {
        return '-';
    }
    if (ids.length === 1) {
        return '#' + ids[0];
    }
    let contiguous = true;
    for (let i = 1; i < ids.length; i++) {
        if (ids[i] !== ids[0] + i) {
            contiguous = false;
            break;
        }
    }
    if (contiguous) {
        return '#' + ids[0] + '-' + ids[ids.length - 1];
    }
    return ids
        .map(function (id) {
            return '#' + id;
        })
        .join(', ');
}

/* =========================================================
   8. ตัวอ่านข้อมูลตู้จากข้อความ (วางจาก CMS)
   ========================================================= */
function findStatusValue(tokens, label) {
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === label) {
            const next = tokens[i + 1];
            if (next === undefined || next.indexOf('สถานะ') === 0) {
                return '';
            }
            return next;
        }
        if (token.indexOf(label + ':') === 0) {
            return token.slice(label.length + 1).trim();
        }
        if (token.indexOf(label + ' ') === 0) {
            return token.slice(label.length).trim();
        }
    }
    return '';
}

function parseMachineText(text) {
    const tokens = text
        .split(/\r?\n/)
        .map(function (line) {
            return line.trim();
        })
        .filter(function (line) {
            return line.length > 0;
        });

    const result = {
        code: '',
        status: {
            online: '',
            stock: '',
            scanner: '',
            temperature: '',
            banknote: '',
            lift: '',
            door: '',
            productDoor: ''
        },
        coins: { 1: null, 5: null, 10: null },
        slots: []
    };

    const codeMatch = text.match(/Machine\s*Activation\s*Code\s*[:：]\s*([A-Za-z0-9_\-]+)/i);
    if (codeMatch) {
        result.code = codeMatch[1];
    }

    let productsIndex = tokens.indexOf('สถานะสินค้า');
    if (productsIndex === -1) {
        productsIndex = tokens.findIndex(function (token) {
            return /^ชั้นที่\s*\d+/.test(token);
        });
        if (productsIndex !== -1) {
            productsIndex = productsIndex - 1;
        }
    }
    const machineTokens = productsIndex === -1 ? tokens : tokens.slice(0, Math.max(productsIndex, 0));

    result.status.online = findStatusValue(machineTokens, 'สถานะออนไลน์');
    result.status.stock = findStatusValue(machineTokens, 'สถานะสต๊อก');
    result.status.scanner = findStatusValue(machineTokens, 'สถานะสแกนเนอร์');
    result.status.temperature = findStatusValue(machineTokens, 'สถานะอุณหภูมิ');
    result.status.banknote = findStatusValue(machineTokens, 'สถานะธนบัตร');
    result.status.lift = findStatusValue(machineTokens, 'สถานะลิฟท์ส่งสินค้า');
    result.status.door = findStatusValue(machineTokens, 'สถานะประตู');
    result.status.productDoor = findStatusValue(machineTokens, 'สถานะประตูสินค้า');

    machineTokens.forEach(function (token) {
        const coinMatch = token.match(/^(\d+)\s*฿\s*\*\s*(-?\d+)/);
        if (coinMatch) {
            const denom = Number(coinMatch[1]);
            if (COIN_DENOMS.indexOf(denom) !== -1) {
                result.coins[denom] = Number(coinMatch[2]);
            }
        }
    });

    if (productsIndex === -1) {
        return result;
    }

    let floor = 0;
    let pendingIds = [];
    let current = null;

    function finalizeSlot() {
        if (!current) {
            return;
        }
        current.label = buildSlotLabel(current.ids);
        result.slots.push(current);
        current = null;
    }

    for (let i = productsIndex + 1; i < tokens.length; i++) {
        const token = tokens[i];

        const floorMatch = token.match(/^ชั้นที่\s*(\d+)/);
        if (floorMatch) {
            finalizeSlot();
            pendingIds = [];
            floor = Number(floorMatch[1]);
            continue;
        }

        const idMatch = token.match(/^#(\d+)$/);
        if (idMatch) {
            finalizeSlot();
            pendingIds.push(Number(idMatch[1]));
            continue;
        }

        if (!current) {
            const nameMatch = token.match(/^\((\d+)\)\s*(.+)$/);
            if (nameMatch && pendingIds.length) {
                current = {
                    ids: pendingIds.slice(),
                    label: '',
                    floor: floor,
                    channels: Number(nameMatch[1]),
                    name: nameMatch[2].trim(),
                    price: null,
                    stock: null,
                    max: MAX_PER_SLOT,
                    dropTest: '',
                    dropDate: '',
                    saleStatus: '',
                    rank: '',
                    m: '',
                    gp: ''
                };
                pendingIds = [];
            }
            continue;
        }

        if (token.indexOf('ราคา') === 0) {
            const priceMatch = token.match(/ราคา\s*([\d,]+(?:\.\d+)?)/);
            if (priceMatch) {
                current.price = Number(priceMatch[1].replace(/,/g, ''));
            }
            continue;
        }

        if (token === 'สินค้าคงเหลือ') {
            const stockToken = tokens[i + 1] || '';
            const stockMatch = stockToken.match(/^(-?\d+)\s*\/\s*(\d+)$/);
            if (stockMatch) {
                current.stock = Number(stockMatch[1]);
                current.max = Number(stockMatch[2]);
            }
            i += 1;
            continue;
        }

        if (token === 'DropTest') {
            current.dropTest = tokens[i + 1] || '';
            i += 1;
            if (tokens[i + 1] !== undefined && tokens[i + 1] !== 'สถานะช่องขาย') {
                current.dropDate = tokens[i + 1];
                i += 1;
            }
            continue;
        }

        if (token === 'สถานะช่องขาย') {
            current.saleStatus = tokens[i + 1] || '';
            i += 1;
            continue;
        }

        if (token === 'Rank') {
            current.rank = tokens[i + 1] || '';
            i += 1;
            continue;
        }

        if (token === 'm') {
            current.m = tokens[i + 1] || '';
            i += 1;
            continue;
        }

        if (token === 'GP') {
            current.gp = tokens[i + 1] || '';
            i += 1;
            continue;
        }
    }
    finalizeSlot();

    return result;
}

/* =========================================================
   9. ตัวอ่านไฟล์ pma_product.txt (PMA, No., Name)
   ========================================================= */
function isPmaText(text) {
    if (/Machine\s*Activation\s*Code/i.test(text)) {
        return false;
    }
    const lines = text.split(/\r?\n/).filter(function (line) {
        return line.trim().length > 0;
    });
    if (!lines.length) {
        return false;
    }
    const first = lines[0].toLowerCase();
    return first.indexOf('pma') !== -1 && first.indexOf('name') !== -1;
}

function parsePmaText(text) {
    const lines = text.split(/\r?\n/).filter(function (line) {
        return line.trim().length > 0;
    });
    const entries = [];
    lines.forEach(function (line, index) {
        const lower = line.toLowerCase();
        if (index === 0 && lower.indexOf('pma') !== -1 && lower.indexOf('name') !== -1) {
            return;
        }
        let match = line.match(/^\s*([^,\t]+?)\s*[,\t]\s*([^,\t]+?)\s*[,\t]\s*(.+?)\s*$/);
        if (!match) {
            match = line.match(/^\s*(\S+)\s+(\S+)\s+(.+?)\s*$/);
        }
        if (!match) {
            return;
        }
        const clean = function (value) {
            return String(value).trim().replace(/^"+|"+$/g, '').trim();
        };
        const entry = { pma: clean(match[1]), no: clean(match[2]), name: clean(match[3]) };
        if (entry.name) {
            entries.push(entry);
        }
    });
    return entries;
}

function normCategoryKey(value) {
    return String(value === null || value === undefined ? '' : value)
        .trim()
        .toLowerCase()
        .replace(/^0+(?=\d)/, '');
}

function rebuildPmaIndex() {
    pmaIndex = { byPma: new Map(), byNo: new Map() };
    state.pma.forEach(function (entry) {
        const pmaKey = normCategoryKey(entry.pma);
        const noKey = normCategoryKey(entry.no);
        if (pmaKey && !pmaIndex.byPma.has(pmaKey)) {
            pmaIndex.byPma.set(pmaKey, entry.name);
        }
        if (noKey && !pmaIndex.byNo.has(noKey)) {
            pmaIndex.byNo.set(noKey, entry.name);
        }
    });
}

function getCategoryLabel(value) {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (!raw) {
        return '';
    }
    const key = normCategoryKey(raw);
    if (pmaIndex.byPma.has(key)) {
        return pmaIndex.byPma.get(key);
    }
    if (pmaIndex.byNo.has(key)) {
        return pmaIndex.byNo.get(key);
    }
    return raw;
}

/* =========================================================
   10. ตัวอ่านไฟล์สินค้า (.xlsx / .csv / .json)
   ========================================================= */
function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/)[0] || '';
    const counts = {
        ',': (firstLine.match(/,/g) || []).length,
        '\t': (firstLine.match(/\t/g) || []).length,
        ';': (firstLine.match(/;/g) || []).length
    };
    let best = ',';
    Object.keys(counts).forEach(function (delimiter) {
        if (counts[delimiter] > counts[best]) {
            best = delimiter;
        }
    });
    return best;
}

function parseCsv(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(field);
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (ch !== '\r') {
            field += ch;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter(function (r) {
        return r.some(function (cell) {
            return String(cell).trim() !== '';
        });
    });
}

function csvToObjects(text) {
    const rows = parseCsv(text, detectDelimiter(text));
    if (rows.length < 2) {
        return [];
    }
    const headers = rows[0].map(function (h) {
        return String(h).trim();
    });
    const objects = [];
    for (let i = 1; i < rows.length; i++) {
        const obj = {};
        headers.forEach(function (header, index) {
            if (header) {
                obj[header] = rows[i][index] === undefined ? '' : rows[i][index];
            }
        });
        objects.push(obj);
    }
    return objects;
}

function jsonToRows(data) {
    let list = null;
    if (Array.isArray(data)) {
        list = data;
    } else if (data && typeof data === 'object') {
        const keys = ['products', 'data', 'items', 'rows'];
        for (let i = 0; i < keys.length; i++) {
            if (Array.isArray(data[keys[i]])) {
                list = data[keys[i]];
                break;
            }
        }
    }
    if (!list) {
        throw new Error('โครงสร้าง JSON ต้องเป็นอาร์เรย์ของสินค้า');
    }
    return list.filter(function (item) {
        return item && typeof item === 'object' && !Array.isArray(item);
    });
}

function cleanCellValue(header, value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? '' : formatDateYmd(value);
    }
    if (typeof value === 'number') {
        return header === H.gp ? value : String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return String(value).trim();
}

function buildProduct(rawRow) {
    const product = {};
    PRODUCT_HEADERS.forEach(function (header) {
        product[header] = '';
    });
    Object.keys(rawRow).forEach(function (key) {
        const header = ALIAS_LOOKUP[normalizeKey(key)];
        if (header) {
            product[header] = cleanCellValue(header, rawRow[key]);
        }
    });
    return product;
}

async function applyProductRows(rows, fileName) {
    const products = rows.map(buildProduct).filter(function (product) {
        return String(product[H.id]).trim() !== '' || String(product[H.name]).trim() !== '';
    });
    if (!products.length) {
        throw new Error('ไม่พบข้อมูลสินค้า หรือชื่อคอลัมน์ไม่ตรงกับ product.xlsx');
    }
    if (state.products.length) {
        const ok = await confirmAction({
            title: 'ยืนยันการนำเข้าสินค้า',
            message:
                'ข้อมูลสินค้าเดิม ' +
                state.products.length +
                ' รายการ จะถูกแทนที่ด้วยข้อมูลใหม่ ' +
                products.length +
                ' รายการ',
            confirmText: 'แทนที่ข้อมูล'
        });
        if (!ok) {
            showNotification('ยกเลิกการนำเข้าสินค้า', 'info');
            return;
        }
    }
    state.products = products;
    state.lastUpdated = new Date().toISOString();
    saveState();
    renderCategoryOptions();
    renderMasterTable();
    renderFooter();
    showNotification('นำเข้าสินค้า ' + products.length + ' รายการจากไฟล์ ' + fileName + ' เรียบร้อย', 'success');
}

async function handleProductFile(file, kind) {
    try {
        let rows = [];
        if (kind === 'xlsx') {
            if (!window.XLSX) {
                throw new Error('โหลดไลบรารี SheetJS ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วโหลดหน้าใหม่');
            }
            const buffer = await file.arrayBuffer();
            const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
            let sheetName = workbook.SheetNames.find(function (name) {
                return normalizeKey(name) === 'product';
            });
            if (!sheetName) {
                sheetName = workbook.SheetNames[0];
            }
            rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
        } else if (kind === 'csv') {
            rows = csvToObjects(decodeText(await file.arrayBuffer()));
        } else if (kind === 'json') {
            rows = jsonToRows(JSON.parse(decodeText(await file.arrayBuffer())));
        }
        await applyProductRows(rows, file.name);
    } catch (err) {
        const detail = err instanceof SyntaxError ? 'รูปแบบ JSON ไม่ถูกต้อง' : err.message;
        showNotification('นำเข้าไฟล์ ' + file.name + ' ไม่สำเร็จ: ' + detail, 'error');
    }
}

/* =========================================================
   11. นำเข้าข้อมูลตู้ (วางข้อความ / ไฟล์ .txt)
   ========================================================= */
function syncMachineInputs() {
    state.machine.province = els.machineProvince.value.trim();
    state.machine.district = els.machineDistrict.value.trim();
    state.machine.gm = els.machineGM.value.trim();
    state.machine.zone = els.machineZone.value.trim();
}

async function applyPmaText(text) {
    const entries = parsePmaText(text);
    if (!entries.length) {
        showNotification('ไม่พบข้อมูล PMA, No., Name ในข้อความ', 'error');
        return;
    }
    state.pma = entries;
    rebuildPmaIndex();
    saveState();
    renderCategoryOptions();
    renderMasterTable();
    showNotification('นำเข้า pma_product ' + entries.length + ' รายการ และแมปหมวดหมู่เรียบร้อย', 'success');
}

async function processMachineText(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        showNotification('กรุณาวางข้อความข้อมูลตู้ก่อน', 'warning');
        return;
    }

    if (isPmaText(trimmed)) {
        await applyPmaText(trimmed);
        return;
    }

    const parsed = parseMachineText(trimmed);
    if (!parsed.code && !parsed.slots.length) {
        showNotification('ไม่พบข้อมูลตู้ในข้อความ กรุณาตรวจสอบว่าคัดลอกมาครบ', 'error');
        return;
    }

    if (state.slots.length) {
        const ok = await confirmAction({
            title: 'ยืนยันการนำเข้าข้อมูลตู้',
            message:
                'ข้อมูลตู้เดิม ' +
                state.slots.length +
                ' ช่อง จะถูกแทนที่ด้วยข้อมูลใหม่ ' +
                parsed.slots.length +
                ' ช่อง',
            confirmText: 'แทนที่ข้อมูล'
        });
        if (!ok) {
            showNotification('ยกเลิกการนำเข้าข้อมูลตู้', 'info');
            return;
        }
    }

    syncMachineInputs();
    if (parsed.code) {
        state.machine.code = parsed.code;
    }
    state.status = parsed.status;
    state.coins = parsed.coins;
    state.slots = parsed.slots;
    state.lastUpdated = new Date().toISOString();
    saveState();
    renderAll();

    const floorCount = new Set(
        parsed.slots.map(function (slot) {
            return slot.floor;
        })
    ).size;

    if (!parsed.slots.length) {
        showNotification('อ่านสถานะเครื่องได้ แต่ไม่พบข้อมูลสินค้าในช่อง', 'warning');
    } else {
        showNotification(
            'อ่านข้อมูลตู้ ' +
                (state.machine.code || '') +
                ' สำเร็จ: ' +
                parsed.slots.length +
                ' ช่อง ' +
                floorCount +
                ' ชั้น',
            'success'
        );
    }
}

async function handleMachineTxtFile(file) {
    try {
        const text = decodeText(await file.arrayBuffer());
        if (!isPmaText(text.trim())) {
            els.machineTextInput.value = text;
        }
        await processMachineText(text);
    } catch (err) {
        showNotification('อ่านไฟล์ ' + file.name + ' ไม่สำเร็จ: ' + err.message, 'error');
    }
}

function saveMachineInfo() {
    syncMachineInputs();
    saveState();
    showNotification('บันทึกข้อมูลเครื่องเรียบร้อย', 'success');
}

/* =========================================================
   12. ส่งออกข้อมูล
   ========================================================= */
function csvEscape(value) {
    const text = String(value === null || value === undefined ? '' : value);
    if (/[",\r\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
}

function exportXlsx() {
    if (!state.products.length) {
        showNotification('ไม่มีข้อมูลสินค้าให้ส่งออก', 'warning');
        return;
    }
    if (!window.XLSX) {
        showNotification('โหลดไลบรารี SheetJS ไม่สำเร็จ ส่งออก .xlsx ไม่ได้', 'error');
        return;
    }
    try {
        const sheet = window.XLSX.utils.json_to_sheet(state.products, { header: PRODUCT_HEADERS });
        sheet['!cols'] = [
            { wch: 18 },
            { wch: 36 },
            { wch: 36 },
            { wch: 14 },
            { wch: 12 },
            { wch: 12 },
            { wch: 18 },
            { wch: 20 },
            { wch: 12 },
            { wch: 10 },
            { wch: 8 },
            { wch: 16 }
        ];
        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, sheet, 'Product');
        window.XLSX.writeFile(workbook, 'product.xlsx');
        showNotification('ส่งออกไฟล์ product.xlsx เรียบร้อย (' + state.products.length + ' รายการ)', 'success');
    } catch (err) {
        showNotification('ส่งออก .xlsx ไม่สำเร็จ: ' + err.message, 'error');
    }
}

function exportCsv() {
    if (!state.products.length) {
        showNotification('ไม่มีข้อมูลสินค้าให้ส่งออก', 'warning');
        return;
    }
    const lines = [PRODUCT_HEADERS.map(csvEscape).join(',')];
    state.products.forEach(function (product) {
        lines.push(
            PRODUCT_HEADERS.map(function (header) {
                return csvEscape(product[header]);
            }).join(',')
        );
    });
    const filename = 'product_' + todayYmd() + '.csv';
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, filename);
    showNotification('ส่งออกไฟล์ ' + filename + ' เรียบร้อย (' + state.products.length + ' รายการ)', 'success');
}

function exportJson() {
    if (!state.products.length) {
        showNotification('ไม่มีข้อมูลสินค้าให้ส่งออก', 'warning');
        return;
    }
    const filename = 'product_' + todayYmd() + '.json';
    const blob = new Blob([JSON.stringify(state.products, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, filename);
    showNotification('ส่งออกไฟล์ ' + filename + ' เรียบร้อย (' + state.products.length + ' รายการ)', 'success');
}

/* =========================================================
   13. การแสดงผล (Render)
   ========================================================= */
function evalOnline(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    const lower = text.toLowerCase();
    if (text.indexOf('ออฟไลน์') !== -1 || lower.indexOf('offline') !== -1) {
        return 'bad';
    }
    if (text.indexOf('ออนไลน์') !== -1 || lower.indexOf('online') !== -1) {
        return 'ok';
    }
    return 'warn';
}

function evalNormal(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    return text.indexOf('ปกติ') !== -1 ? 'ok' : 'bad';
}

function evalDoor(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    return text === 'ปิด' ? 'ok' : 'warn';
}

function evalProductDoor(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    if (text.indexOf('ไม่') === 0) {
        return 'warn';
    }
    return text.indexOf('ล็อค') !== -1 || text.indexOf('ล็อก') !== -1 ? 'ok' : 'warn';
}

function evalStockRatio(value) {
    const match = String(value || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) {
        return '';
    }
    const have = Number(match[1]);
    const total = Number(match[2]);
    if (have >= total) {
        return 'ok';
    }
    return have === 0 ? 'bad' : 'warn';
}

function evalNone() {
    return '';
}

const STATUS_ITEMS = [
    { key: 'online', valueId: 'statusOnline', evaluate: evalOnline },
    { key: 'stock', valueId: 'statusStock', evaluate: evalStockRatio },
    { key: 'scanner', valueId: 'statusScanner', evaluate: evalOnline },
    { key: 'temperature', valueId: 'statusTemperature', evaluate: evalNone },
    { key: 'banknote', valueId: 'statusBanknote', evaluate: evalNormal },
    { key: 'lift', valueId: 'statusLift', evaluate: evalNormal },
    { key: 'door', valueId: 'statusDoor', evaluate: evalDoor },
    { key: 'productDoor', valueId: 'statusProductDoor', evaluate: evalProductDoor }
];

function setStatusItem(key, valueElement, text, level) {
    const item = document.querySelector('.status-item[data-status-key="' + key + '"]');
    valueElement.textContent = text || '-';
    if (item) {
        item.classList.remove('is-ok', 'is-warn', 'is-bad');
        if (level) {
            item.classList.add('is-' + level);
        }
    }
}

function renderMachineInfo() {
    els.machineActivationCode.textContent = state.machine.code || '-';
    els.machineProvince.value = state.machine.province || '';
    els.machineDistrict.value = state.machine.district || '';
    els.machineGM.value = state.machine.gm || '';
    els.machineZone.value = state.machine.zone || '';
}

function renderStatus() {
    STATUS_ITEMS.forEach(function (config) {
        const value = state.status[config.key] || '';
        setStatusItem(config.key, els[config.valueId], value, config.evaluate(value));
    });

    COIN_DENOMS.forEach(function (denom) {
        const info = calcCoinRefill(denom, state.coins[denom]);
        const valueElement = els['statusCoin' + denom];
        if (info.remaining === null) {
            setStatusItem('coin' + denom, valueElement, '', '');
        } else {
            setStatusItem('coin' + denom, valueElement, info.remaining + ' เหรียญ', info.refill === 0 ? 'ok' : 'warn');
        }
    });
}

function renderCoins() {
    COIN_DENOMS.forEach(function (denom) {
        const info = calcCoinRefill(denom, state.coins[denom]);
        const currentEl = document.getElementById('coin' + denom + 'Current');
        const refillEl = document.getElementById('coin' + denom + 'Refill');
        const percentEl = document.getElementById('coin' + denom + 'Percent');
        const barEl = document.getElementById('coin' + denom + 'ProgressBar');
        const progressEl = document.getElementById('coin' + denom + 'Progress');

        currentEl.textContent = info.remaining === null ? '-' : info.remaining;
        refillEl.textContent = info.refill === null ? '-' : info.refill;
        percentEl.textContent = info.percent;
        barEl.style.width = info.percent + '%';
        progressEl.setAttribute('aria-valuenow', String(info.percent));

        barEl.classList.remove('is-ok', 'is-warn', 'is-low', 'is-empty');
        if (info.remaining !== null) {
            if (info.percent >= 75) {
                barEl.classList.add('is-ok');
            } else if (info.percent >= 40) {
                barEl.classList.add('is-warn');
            } else if (info.percent >= 15) {
                barEl.classList.add('is-low');
            } else {
                barEl.classList.add('is-empty');
            }
        }
    });
}

function renderProductRefill() {
    const slots = state.slots;
    let needSlots = 0;
    let totalPieces = 0;

    if (!slots.length) {
        els.productRefillBody.innerHTML =
            '<tr class="empty-row"><td colspan="6">ยังไม่มีข้อมูลสินค้าในตู้ กรุณานำเข้าข้อมูล</td></tr>';
        els.statTotalSlots.textContent = '0';
        els.statNeedRefillSlots.textContent = '0';
        els.statNoRefillSlots.textContent = '0';
        els.statTotalPieces.textContent = '0';
        return;
    }

    const rows = slots.map(function (slot) {
        const calc = calcSlotRefill(slot);
        let rowClass = '';
        let badge = '<span class="badge badge-ok"><i class="fa-solid fa-check" aria-hidden="true"></i> ไม่ต้องเติม</span>';
        if (calc.need > 0) {
            needSlots += 1;
            totalPieces += calc.need;
            if (calc.effective === 0) {
                rowClass = 'row-critical';
                badge = '<span class="badge badge-critical"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> หมด ต้องเติม</span>';
            } else {
                rowClass = 'row-need';
                badge = '<span class="badge badge-need"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> ต้องเติม</span>';
            }
        }

        let remainingText = calc.raw === null ? '-' : String(calc.raw);
        if (calc.raw !== null && calc.raw < 0) {
            remainingText = '0 (ติดลบ ' + calc.raw + ')';
        }

        return (
            '<tr class="' +
            rowClass +
            '">' +
            '<td>' +
            escapeHtml(slot.label) +
            '</td>' +
            '<td>' +
            escapeHtml(slot.name) +
            '</td>' +
            '<td class="text-center">' +
            escapeHtml(remainingText) +
            '</td>' +
            '<td class="text-center">' +
            MAX_PER_SLOT +
            '</td>' +
            '<td class="text-center">' +
            calc.need +
            '</td>' +
            '<td class="text-center">' +
            badge +
            '</td>' +
            '</tr>'
        );
    });

    els.productRefillBody.innerHTML = rows.join('');
    els.statTotalSlots.textContent = String(slots.length);
    els.statNeedRefillSlots.textContent = String(needSlots);
    els.statNoRefillSlots.textContent = String(slots.length - needSlots);
    els.statTotalPieces.textContent = String(totalPieces);
}

function renderLayout() {
    if (!state.slots.length) {
        els.machineLayout.innerHTML = '<p class="empty-state">ยังไม่มีข้อมูลแผนผังตู้ กรุณานำเข้าข้อมูล</p>';
        return;
    }

    const floors = new Map();
    state.slots.forEach(function (slot) {
        if (!floors.has(slot.floor)) {
            floors.set(slot.floor, []);
        }
        floors.get(slot.floor).push(slot);
    });

    const floorNumbers = Array.from(floors.keys()).sort(function (a, b) {
        return a - b;
    });

    const html = floorNumbers.map(function (floorNumber) {
        const floorSlots = floors.get(floorNumber);
        let needCount = 0;

        const tiles = floorSlots.map(function (slot) {
            const calc = calcSlotRefill(slot);
            if (calc.need > 0) {
                needCount += 1;
            }
            const merged = slot.ids && slot.ids.length > 1 ? ' is-merged' : '';
            const priceText = slot.price === null || slot.price === undefined ? '-' : '฿' + slot.price;
            const stockText = calc.raw === null ? '-' : calc.raw + '/' + MAX_PER_SLOT;
            const tooltip = [
                slot.label + ' ' + slot.name,
                'ราคา ' + (slot.price === null || slot.price === undefined ? '-' : slot.price + ' บาท'),
                'คงเหลือ ' + stockText,
                'DropTest: ' + (slot.dropTest || '-') + (slot.dropDate ? ' (' + slot.dropDate + ')' : ''),
                'สถานะช่องขาย: ' + (slot.saleStatus || '-'),
                'Rank ' + (slot.rank || '-') + ' | m ' + (slot.m || '-') + ' | GP ' + (slot.gp || '-')
            ].join('\n');

            return (
                '<div class="slot-tile stock-' +
                calc.level +
                merged +
                '" title="' +
                escapeHtml(tooltip) +
                '">' +
                '<span class="slot-id">' +
                escapeHtml(slot.label) +
                '</span>' +
                '<span class="slot-name">' +
                escapeHtml(shortenText(slot.name, 24)) +
                '</span>' +
                '<div class="slot-foot">' +
                '<span class="slot-price">' +
                escapeHtml(priceText) +
                '</span>' +
                '<span class="slot-stock">' +
                escapeHtml(stockText) +
                '</span>' +
                '</div>' +
                '</div>'
            );
        });

        return (
            '<div class="layout-floor">' +
            '<div class="floor-head">' +
            '<h3 class="floor-title">ชั้นที่ ' +
            floorNumber +
            '</h3>' +
            '<span class="floor-summary">ต้องเติม ' +
            needCount +
            ' จาก ' +
            floorSlots.length +
            ' ช่อง</span>' +
            '</div>' +
            '<div class="floor-slots">' +
            tiles.join('') +
            '</div>' +
            '</div>'
        );
    });

    els.machineLayout.innerHTML = html.join('');
}

function collectCategories() {
    const set = new Set();
    state.products.forEach(function (product) {
        const label = getCategoryLabel(product[H.category]);
        if (label) {
            set.add(label);
        }
    });
    if (!set.size) {
        state.pma.forEach(function (entry) {
            if (entry.name) {
                set.add(entry.name);
            }
        });
    }
    return Array.from(set).sort(function (a, b) {
        return a.localeCompare(b, 'th');
    });
}

function renderCategoryOptions() {
    const previous = els.categoryFilter.value;
    const categories = collectCategories();
    let html = '<option value="">ทั้งหมด</option>';
    categories.forEach(function (category) {
        html += '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>';
    });
    els.categoryFilter.innerHTML = html;
    if (previous && categories.indexOf(previous) !== -1) {
        els.categoryFilter.value = previous;
    }
}

function getFilteredProducts() {
    const query = els.searchInput.value.trim().toLowerCase();
    const category = els.categoryFilter.value;
    const status = els.statusFilter.value;

    return state.products.filter(function (product) {
        if (status && String(product[H.status]).trim().toLowerCase() !== status) {
            return false;
        }
        if (category && getCategoryLabel(product[H.category]) !== category) {
            return false;
        }
        if (query) {
            const haystack = (
                String(product[H.name]) +
                ' ' +
                String(product[H.nameEn]) +
                ' ' +
                String(product[H.barcode])
            ).toLowerCase();
            if (haystack.indexOf(query) === -1) {
                return false;
            }
        }
        return true;
    });
}

function allowSaleBadge(value) {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (!raw) {
        return '-';
    }
    const lower = raw.toLowerCase();
    if (['y', 'yes', 'true', '1', 'อนุญาต', 'ได้'].indexOf(lower) !== -1) {
        return '<span class="badge badge-ok">อนุญาต</span>';
    }
    if (['n', 'no', 'false', '0', 'ไม่อนุญาต', 'ไม่ได้'].indexOf(lower) !== -1) {
        return '<span class="badge badge-disable">ไม่อนุญาต</span>';
    }
    return '<span class="badge badge-neutral">' + escapeHtml(raw) + '</span>';
}

function statusBadge(value) {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (!raw) {
        return '-';
    }
    const lower = raw.toLowerCase();
    if (lower === 'publish') {
        return '<span class="badge badge-publish">publish</span>';
    }
    if (lower === 'disable') {
        return '<span class="badge badge-disable">disable</span>';
    }
    return '<span class="badge badge-neutral">' + escapeHtml(raw) + '</span>';
}

function formatGp(value) {
    if (value === '' || value === null || value === undefined) {
        return '-';
    }
    if (typeof value === 'number') {
        return String(Math.round(value * 100) / 100);
    }
    return String(value);
}

function renderMasterTable() {
    const total = state.products.length;
    const filtered = getFilteredProducts();

    els.masterCount.textContent =
        filtered.length === total ? total + ' รายการ' : filtered.length + ' / ' + total + ' รายการ';

    if (!total) {
        els.masterBody.innerHTML =
            '<tr class="empty-row"><td colspan="12">ยังไม่มีข้อมูลสินค้า กรุณานำเข้าไฟล์ product.xlsx</td></tr>';
        return;
    }
    if (!filtered.length) {
        els.masterBody.innerHTML =
            '<tr class="empty-row"><td colspan="12">ไม่พบสินค้าที่ตรงกับตัวกรอง</td></tr>';
        return;
    }

    const rows = filtered.map(function (product) {
        return (
            '<tr>' +
            '<td>' +
            escapeHtml(product[H.id]) +
            '</td>' +
            '<td>' +
            escapeHtml(product[H.name]) +
            '</td>' +
            '<td>' +
            escapeHtml(product[H.nameEn]) +
            '</td>' +
            '<td>' +
            escapeHtml(product[H.spiralType]) +
            '</td>' +
            '<td>' +
            escapeHtml(product[H.spiralSize]) +
            '</td>' +
            '<td>' +
            escapeHtml(product[H.beltColor]) +
            '</td>' +
            '<td>' +
            escapeHtml(product[H.barcode]) +
            '</td>' +
            '<td>' +
            escapeHtml(getCategoryLabel(product[H.category])) +
            '</td>' +
            '<td class="text-center">' +
            allowSaleBadge(product[H.allowSale]) +
            '</td>' +
            '<td class="text-center">' +
            statusBadge(product[H.status]) +
            '</td>' +
            '<td class="text-right">' +
            escapeHtml(formatGp(product[H.gp])) +
            '</td>' +
            '<td>' +
            escapeHtml(product[H.startDate]) +
            '</td>' +
            '</tr>'
        );
    });

    els.masterBody.innerHTML = rows.join('');
}

function renderFooter() {
    els.lastUpdated.textContent = formatDateTimeThai(state.lastUpdated);
}

function renderAll() {
    renderMachineInfo();
    renderStatus();
    renderCoins();
    renderProductRefill();
    renderLayout();
    renderCategoryOptions();
    renderMasterTable();
    renderFooter();
}

/* =========================================================
   14. โหลดไฟล์ pma_product.txt อัตโนมัติ (เมื่อเปิดผ่านเว็บเซิร์ฟเวอร์)
   ========================================================= */
async function tryLoadPmaFile() {
    if (state.pma.length) {
        return;
    }
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
        return;
    }
    try {
        const response = await fetch('pma_product.txt', { cache: 'no-cache' });
        if (!response.ok) {
            return;
        }
        const entries = parsePmaText(decodeText(await response.arrayBuffer()));
        if (entries.length) {
            state.pma = entries;
            rebuildPmaIndex();
            saveState();
            renderCategoryOptions();
            renderMasterTable();
        }
    } catch (err) {
        return;
    }
}

/* =========================================================
   15. ผูกอีเวนต์ และเริ่มทำงาน
   ========================================================= */
function cacheElements() {
    const ids = [
        'notificationBar',
        'notificationIcon',
        'notificationMessage',
        'notificationClose',
        'btnImportXlsx',
        'btnImportCsv',
        'btnImportJson',
        'btnExportXlsx',
        'btnExportCsv',
        'btnExportJson',
        'fileInputXlsx',
        'fileInputCsv',
        'fileInputJson',
        'machineActivationCode',
        'machineProvince',
        'machineDistrict',
        'machineGM',
        'machineZone',
        'btnSaveMachineInfo',
        'statusOnline',
        'statusStock',
        'statusScanner',
        'statusTemperature',
        'statusBanknote',
        'statusLift',
        'statusDoor',
        'statusProductDoor',
        'statusCoin1',
        'statusCoin5',
        'statusCoin10',
        'machineTextInput',
        'btnParseMachineText',
        'btnImportMachineTxt',
        'btnClearMachineText',
        'fileInputMachineTxt',
        'statTotalSlots',
        'statNeedRefillSlots',
        'statNoRefillSlots',
        'statTotalPieces',
        'productRefillBody',
        'machineLayout',
        'searchInput',
        'categoryFilter',
        'statusFilter',
        'masterCount',
        'masterBody',
        'confirmModal',
        'modalTitle',
        'modalMessage',
        'modalCancel',
        'modalConfirm',
        'lastUpdated'
    ];
    ids.forEach(function (id) {
        els[id] = document.getElementById(id);
    });
    els.modal = els.confirmModal;
}

function bindFileInput(button, input, handler) {
    button.addEventListener('click', function () {
        input.click();
    });
    input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        input.value = '';
        if (file) {
            handler(file);
        }
    });
}

function bindEvents() {
    els.notificationClose.addEventListener('click', hideNotification);

    bindFileInput(els.btnImportXlsx, els.fileInputXlsx, function (file) {
        handleProductFile(file, 'xlsx');
    });
    bindFileInput(els.btnImportCsv, els.fileInputCsv, function (file) {
        handleProductFile(file, 'csv');
    });
    bindFileInput(els.btnImportJson, els.fileInputJson, function (file) {
        handleProductFile(file, 'json');
    });
    bindFileInput(els.btnImportMachineTxt, els.fileInputMachineTxt, handleMachineTxtFile);

    els.btnExportXlsx.addEventListener('click', exportXlsx);
    els.btnExportCsv.addEventListener('click', exportCsv);
    els.btnExportJson.addEventListener('click', exportJson);

    els.btnParseMachineText.addEventListener('click', function () {
        processMachineText(els.machineTextInput.value);
    });
    els.btnClearMachineText.addEventListener('click', function () {
        els.machineTextInput.value = '';
        els.machineTextInput.focus();
    });

    els.btnSaveMachineInfo.addEventListener('click', saveMachineInfo);
    [els.machineProvince, els.machineDistrict, els.machineGM, els.machineZone].forEach(function (input) {
        input.addEventListener('input', syncMachineInputs);
    });

    els.searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderMasterTable, 150);
    });
    els.categoryFilter.addEventListener('change', renderMasterTable);
    els.statusFilter.addEventListener('change', renderMasterTable);

    els.modalConfirm.addEventListener('click', function () {
        closeModal(true);
    });
    els.modalCancel.addEventListener('click', function () {
        closeModal(false);
    });
    els.modal.addEventListener('click', function (event) {
        if (event.target === els.modal) {
            closeModal(false);
        }
    });
    document.addEventListener('keydown', handleModalKeydown);
}

function init() {
    cacheElements();
    loadState();
    rebuildPmaIndex();
    bindEvents();
    renderAll();
    tryLoadPmaFile();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
