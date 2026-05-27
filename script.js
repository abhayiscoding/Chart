
// ========================================
// CSV PARSER
// ========================================

class CSVParser {
    static parse(csvText) {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) throw new Error('CSV must have header and data');
        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        const requiredFields = ['datetime', 'open', 'high', 'low', 'close', 'volume'];
        const missingFields = requiredFields.filter(f => !header.includes(f));
        if (missingFields.length > 0) {
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            // Handle quoted CSV fields
            const fields = this.parseCSVLine(line);
            if (fields.length < header.length) continue;
            const row = {};
            header.forEach((h, idx) => {
                row[h] = fields[idx];
            });
            try {
                data.push({
                    datetime: new Date(row.datetime),
                    open: parseFloat(row.open),
                    high: parseFloat(row.high),
                    low: parseFloat(row.low),
                    close: parseFloat(row.close),
                    volume: parseInt(row.volume, 10)
                });
            } catch (e) {
                console.warn(`Skipping malformed row ${i}:`, row);
            }
        }
        if (data.length === 0) throw new Error('No valid data found in CSV');
        return data;
    }

    static parseCSVLine(line) {
        const result = [];
        let current = '';
        let insideQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (insideQuotes && nextChar === '"') {
                    current += '"';
                    i++; // Skip next quote
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (char === ',' && !insideQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current.trim());
        return result;
    }
}

// ========================================
// CHART ENGINE
// ========================================

class ChartEngine {
    constructor() {
        // DOM elements
        this.priceCanvas = document.getElementById('priceCanvas');
        this.volumeCanvas = document.getElementById('volumeCanvas');
        this.priceCtx = this.priceCanvas.getContext('2d', { alpha: false });
        this.volumeCtx = this.volumeCanvas.getContext('2d', { alpha: false });
        this.crosshairV = document.getElementById('crosshairV');
        this.crosshairH = document.getElementById('crosshairH');
        this.tooltip = document.getElementById('tooltip');
        this.ohlcvDisplay = document.getElementById('ohlcvDisplay');
        this.priceAxisLabel = document.getElementById('priceAxisLabel');
        this.timeAxis = document.getElementById('timeAxis');
        this.errorMessage = document.getElementById('errorMessage');
        this.scrollbarThumb = document.getElementById('scrollbarThumb');
        this.csvUpload = document.getElementById('csvUpload');

        // Chart data
        this.data = [];
        this.symbol = document.getElementsByClassName("symbol")[0].innerText;

        // Layout constants
        this.rightAxisWidth = 80;
        this.leftAxisWidth = 0;
        this.priceChartHeight = 0;
        this.volumeChartHeight = 0;
        this.topPadding = 10;
        this.bottomPadding = 10;

        // Scale and offset
        this.scrollOffset = 0; // horizontal scroll in pixels
        this.candleWidth = 8; // pixels per candle
        this.candleGap = 2;
        this.zoomLevel = 1;
        this.maxCandlesVisible = 100;

        // Mouse state
        this.mouseX = 0;
        this.mouseY = 0;
        this.isMouseOver = false;
        this.mouseCandle = null;

        // Performance
        this.needsRedraw = false;
        this.redrawScheduled = false;
        this.lastDrawTime = 0;

        this.init();
    }

    init() {
        this.loadSampleData();
        this.setupEventListeners();
        this.resizeCanvases();
        this.draw();
    }

    loadSampleData() {
        // Load from CSV file (fetch sample_data.csv or allow user upload)
        fetch(`${this.symbol}.csv`)
            .then(res => res.text())
            .then(text => {
                try {
                    this.data = CSVParser.parse(text);
                    this.resetView();
                    this.draw();
                } catch (err) {
                    this.showError(`CSV Error: ${err.message}`);
                }
            })
            .catch(err => {
                console.warn('Could not load sample_data.csv, waiting for user input');
            });
    }

    setupEventListeners() {
        // Resize
        window.addEventListener('resize', () => this.handleResize());

        // Mouse events
        this.priceCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.priceCanvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        this.priceCanvas.addEventListener('wheel', (e) => this.handleMouseWheel(e));

        // Drag to scroll
        let isDragging = false;
        let dragStartX = 0;
        let dragStartOffset = 0;

        this.priceCanvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartOffset = this.scrollOffset;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const delta = e.clientX - dragStartX;
                this.scrollOffset = Math.max(0, dragStartOffset - delta);
                this.scheduleRedraw();
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // CSV Upload
        this.csvUpload.addEventListener('change', (e) => this.handleCSVUpload(e));
        document.querySelector('.btn-upload').addEventListener('click', () => {
            this.csvUpload.click();
        });

        // Scrollbar
        this.setupScrollbar();
    }

    setupScrollbar() {
        const trackElement = document.querySelector('.scrollbar-track');
        trackElement.addEventListener('click', (e) => {
            const rect = trackElement.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const trackWidth = rect.width;
            const ratio = clickX / trackWidth;
            
            const maxScroll = this.getMaxScroll();
            this.scrollOffset = ratio * maxScroll;
            this.scheduleRedraw();
        });

        // Drag thumb
        let isDraggingThumb = false;
        let dragStartX = 0;
        let dragStartOffset = 0;

        this.scrollbarThumb.addEventListener('mousedown', (e) => {
            isDraggingThumb = true;
            dragStartX = e.clientX;
            dragStartOffset = this.scrollOffset;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (isDraggingThumb) {
                const trackRect = document.querySelector('.scrollbar-track').getBoundingClientRect();
                const delta = e.clientX - dragStartX;
                const trackWidth = trackRect.width;
                const thumbWidth = this.scrollbarThumb.offsetWidth;
                const maxThumbPos = trackWidth - thumbWidth;
                
                const maxScroll = this.getMaxScroll();
                const ratio = (dragStartOffset + delta) / maxScroll;
                this.scrollOffset = Math.max(0, Math.min(maxScroll, ratio * maxScroll));
                this.scheduleRedraw();
            }
        });

        document.addEventListener('mouseup', () => {
            isDraggingThumb = false;
        });
    }

    handleCSVUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                this.data = CSVParser.parse(event.target.result);
                this.resetView();
                this.draw();
                this.errorMessage.classList.remove('active');
            } catch (err) {
                this.showError(`CSV Error: ${err.message}`);
            }
        };
        reader.readAsText(file);
    }

    handleMouseMove(e) {
        const rect = this.priceCanvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        this.isMouseOver = true;

        this.updateCrosshair();
        this.updateOHLCV();
        this.scheduleRedraw();
    }

    handleMouseLeave() {
        this.isMouseOver = false;
        this.crosshairV.classList.remove('active');
        this.crosshairH.classList.remove('active');
        this.tooltip.classList.remove('active');
        this.ohlcvDisplay.classList.remove('active');
        this.priceAxisLabel.classList.remove('active');
        this.scheduleRedraw();
    }

    handleMouseWheel(e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();

        const oldZoom = this.zoomLevel;
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoomLevel = Math.max(0.5, Math.min(5, this.zoomLevel * zoomDelta));

        // Adjust scroll offset to maintain mouse position
        const candleIndex = this.getCandle();
        if (candleIndex !== null) {
            const ratio = this.zoomLevel / oldZoom;
            this.scrollOffset = Math.max(0, this.scrollOffset + (this.mouseX - 40) * (1 - ratio));
        }

        this.scheduleRedraw();
    }

    handleResize() {
        this.resizeCanvases();
        this.scheduleRedraw();
    }

    resizeCanvases() {
        const container = document.querySelector('.chart-wrapper');
        const priceContainer = document.querySelector('.price-chart-container');
        const volumeContainer = document.querySelector('.volume-chart-container');

        const width = container.clientWidth;
        const priceHeight = priceContainer.clientHeight;
        const volumeHeight = volumeContainer.clientHeight;

        // Set canvas size (in pixels)
        this.priceCanvas.width = width;
        this.priceCanvas.height = priceHeight;
        this.volumeCanvas.width = width;
        this.volumeCanvas.height = volumeHeight;

        this.priceChartHeight = priceHeight;
        this.volumeChartHeight = volumeHeight;
    }

    getCandle() {
        if (this.data.length === 0) return null;

        const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;
        const candleIndex = Math.floor((this.scrollOffset + this.mouseX - this.leftAxisWidth) / candlePixelWidth);
        const visibleStart = this.getVisibleStartIndex();
        
        if (candleIndex < 0) return null;
        const dataIndex = visibleStart + candleIndex;
        return dataIndex < this.data.length ? dataIndex : null;
    }

    getVisibleStartIndex() {
        const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;
        return Math.floor(this.scrollOffset / candlePixelWidth);
    }

    updateCrosshair() {
        if (!this.isMouseOver || this.data.length === 0) return;

        // Vertical line
        this.crosshairV.style.left = this.mouseX + 'px';
        this.crosshairV.style.height = (this.priceChartHeight + this.volumeChartHeight) + 'px';

        // Horizontal line (in price chart area)
        this.crosshairH.style.top = this.mouseY + 'px';
        this.crosshairH.style.width = (this.priceCanvas.width - this.rightAxisWidth) + 'px';

        this.crosshairV.classList.add('active');
        this.crosshairH.classList.add('active');

        // Price axis label
        if (this.mouseY < this.priceChartHeight) {
            const price = this.getPrice(this.mouseY);
            this.priceAxisLabel.textContent = price.toFixed(2);
            this.priceAxisLabel.style.top = Math.max(0, this.mouseY - 12) + 'px';
            this.priceAxisLabel.classList.add('active');
        } else {
            this.priceAxisLabel.classList.remove('active');
        }
    }

    updateOHLCV() {
        const candleIndex = this.getCandle();
        if (candleIndex === null) {
            this.ohlcvDisplay.classList.remove('active');
            this.tooltip.classList.remove('active');
            return;
        }

        const candle = this.data[candleIndex];
        const timeStr = candle.datetime.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const ohlcvText = `O: ${candle.open.toFixed(2)} H: ${candle.high.toFixed(2)} L: ${candle.low.toFixed(2)} C: ${candle.close.toFixed(2)} V: ${(candle.volume / 1000000).toFixed(2)}M`;
        this.ohlcvDisplay.textContent = ohlcvText;
        this.ohlcvDisplay.classList.add('active');

        // Tooltip
        this.tooltip.innerHTML = `
            <div class="tooltip-row">
                <span class="tooltip-label">Time</span>
                <span class="tooltip-value">${timeStr}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">O</span>
                <span class="tooltip-value">${candle.open.toFixed(2)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">H</span>
                <span class="tooltip-value">${candle.high.toFixed(2)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">L</span>
                <span class="tooltip-value">${candle.low.toFixed(2)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">C</span>
                <span class="tooltip-value">${candle.close.toFixed(2)}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">V</span>
                <span class="tooltip-value">${(candle.volume / 1000000).toFixed(2)}M</span>
            </div>
        `;

        // Position tooltip
        let tooltipX = this.mouseX + 15;
        let tooltipY = this.mouseY - 60;

        if (tooltipX + 180 > this.priceCanvas.width) {
            tooltipX = this.mouseX - 195;
        }
        if (tooltipY < 0) {
            tooltipY = this.mouseY + 15;
        }

        this.tooltip.style.left = tooltipX + 'px';
        this.tooltip.style.top = tooltipY + 'px';
        this.tooltip.classList.add('active');
    }

    scheduleRedraw() {
        if (this.redrawScheduled) return;
        this.redrawScheduled = true;

        requestAnimationFrame(() => {
            this.draw();
            this.redrawScheduled = false;
        });
    }

    draw() {
        const now = performance.now();
        this.lastDrawTime = now;

        if (this.data.length === 0) {
            this.drawEmpty();
            this.updateScrollbar();
            return;
        }

        // Clear canvases
        this.priceCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
        this.priceCtx.fillRect(0, 0, this.priceCanvas.width, this.priceCanvas.height);

        this.volumeCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim();
        this.volumeCtx.fillRect(0, 0, this.volumeCanvas.width, this.volumeCanvas.height);

        // Draw grid
        this.drawGrid();

        // Get visible data range
        const visibleStartIdx = this.getVisibleStartIndex();
        const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;
        const visibleCandlesCount = Math.ceil(this.priceCanvas.width / candlePixelWidth) + 2;
        const visibleEndIdx = Math.min(visibleStartIdx + visibleCandlesCount, this.data.length);

        if (visibleEndIdx > visibleStartIdx) {
            const visibleData = this.data.slice(visibleStartIdx, visibleEndIdx);

            // Calculate price scale
            this.calculateScale(visibleData);

            // Draw candlesticks and volume
            this.drawCandles(visibleData, visibleStartIdx);
            this.drawVolume(visibleData, visibleStartIdx);

            // Draw axes
            this.drawPriceAxis();
            this.drawTimeAxis(visibleStartIdx, visibleEndIdx);
        }

        this.updateScrollbar();
    }

    drawEmpty() {
        this.priceCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
        this.priceCtx.fillRect(0, 0, this.priceCanvas.width, this.priceCanvas.height);

        this.priceCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
        this.priceCtx.font = '14px monospace';
        this.priceCtx.textAlign = 'center';
        this.priceCtx.fillText('No data loaded', this.priceCanvas.width / 2, this.priceCanvas.height / 2);
    }

    drawGrid() {
        const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim();
        this.priceCtx.strokeStyle = gridColor;
        this.priceCtx.lineWidth = 1;

        // Horizontal grid lines (price levels)
        const step = this.getGridStep();
        const minPrice = Math.floor(this.minPrice / step) * step;
        const maxPrice = Math.ceil(this.maxPrice / step) * step;

        for (let price = minPrice; price <= maxPrice; price += step) {
            const y = this.getPricePixel(price);
            this.priceCtx.beginPath();
            this.priceCtx.moveTo(0, y);
            this.priceCtx.lineTo(this.priceCanvas.width - this.rightAxisWidth, y);
            this.priceCtx.stroke();
        }

        // Vertical grid lines (time)
        const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;
        const verticalGridSpacing = Math.ceil(10 / this.zoomLevel) * candlePixelWidth;

        for (let x = -this.scrollOffset % verticalGridSpacing; x < this.priceCanvas.width; x += verticalGridSpacing) {
            this.priceCtx.beginPath();
            this.priceCtx.moveTo(x + this.leftAxisWidth, 0);
            this.priceCtx.lineTo(x + this.leftAxisWidth, this.priceChartHeight);
            this.priceCtx.stroke();
        }

        // Same grid for volume chart
        this.volumeCtx.strokeStyle = gridColor;
        this.volumeCtx.lineWidth = 1;
        
        for (let x = -this.scrollOffset % verticalGridSpacing; x < this.volumeCanvas.width; x += verticalGridSpacing) {
            this.volumeCtx.beginPath();
            this.volumeCtx.moveTo(x + this.leftAxisWidth, 0);
            this.volumeCtx.lineTo(x + this.leftAxisWidth, this.volumeChartHeight);
            this.volumeCtx.stroke();
        }
    }

    calculateScale(visibleData) {
        if (visibleData.length === 0) {
            this.minPrice = 0;
            this.maxPrice = 100;
            this.minVolume = 0;
            this.maxVolume = 1000000;
            return;
        }

        this.minPrice = Math.min(...visibleData.map(c => c.low));
        this.maxPrice = Math.max(...visibleData.map(c => c.high));
        this.minVolume = 0;
        this.maxVolume = Math.max(...visibleData.map(c => c.volume));

        // Add padding
        const pricePadding = (this.maxPrice - this.minPrice) * 0.05;
        this.minPrice -= pricePadding;
        this.maxPrice += pricePadding;
    }

    drawCandles(visibleData, startIndex) {
        const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;
        
        for (let i = 0; i < visibleData.length; i++) {
            const candle = visibleData[i];
            const x = i * candlePixelWidth - (this.scrollOffset % candlePixelWidth) + this.leftAxisWidth;

            // Skip if off-screen
            if (x + this.candleWidth < 0 || x > this.priceCanvas.width - this.rightAxisWidth) {
                continue;
            }

            this.drawCandle(x, candle);
        }
    }

    drawCandle(x, candle) {
        const open = candle.open;
        const high = candle.high;
        const low = candle.low;
        const close = candle.close;

        const openY = this.getPricePixel(open);
        const closeY = this.getPricePixel(close);
        const highY = this.getPricePixel(high);
        const lowY = this.getPricePixel(low);

        const isBullish = close >= open;
        const color = isBullish ? 
            getComputedStyle(document.documentElement).getPropertyValue('--accent-green').trim() :
            getComputedStyle(document.documentElement).getPropertyValue('--accent-red').trim();

        // Wick (high-low line)
        this.priceCtx.strokeStyle = color;
        this.priceCtx.lineWidth = 1;
        this.priceCtx.beginPath();
        this.priceCtx.moveTo(x + this.candleWidth / 2, highY);
        this.priceCtx.lineTo(x + this.candleWidth / 2, lowY);
        this.priceCtx.stroke();

        // Body (open-close rectangle)
        this.priceCtx.fillStyle = color;
        const bodyTop = Math.min(openY, closeY);
        const bodyBottom = Math.max(openY, closeY);
        const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

        this.priceCtx.fillRect(x, bodyTop, this.candleWidth, bodyHeight);
        this.priceCtx.strokeStyle = color;
        this.priceCtx.strokeRect(x, bodyTop, this.candleWidth, bodyHeight);
    }

    drawVolume(visibleData, startIndex) {
        const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;

        for (let i = 0; i < visibleData.length; i++) {
            const candle = visibleData[i];
            const x = i * candlePixelWidth - (this.scrollOffset % candlePixelWidth) + this.leftAxisWidth;

            if (x + this.candleWidth < 0 || x > this.volumeCanvas.width - this.rightAxisWidth) {
                continue;
            }

            const isBullish = candle.close >= candle.open;
            const color = isBullish ?
                getComputedStyle(document.documentElement).getPropertyValue('--accent-green').trim() :
                getComputedStyle(document.documentElement).getPropertyValue('--accent-red').trim();

            const volumeHeight = (candle.volume / this.maxVolume) * this.volumeChartHeight * 0.9;
            const y = this.volumeChartHeight - volumeHeight;

            this.volumeCtx.fillStyle = color;
            this.volumeCtx.globalAlpha = 0.4;
            this.volumeCtx.fillRect(x, y, this.candleWidth, volumeHeight);
            this.volumeCtx.globalAlpha = 1;
        }
    }

    drawPriceAxis() {
        const axisColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
        const step = this.getGridStep();
        const minPrice = Math.floor(this.minPrice / step) * step;
        const maxPrice = Math.ceil(this.maxPrice / step) * step;

        this.priceCtx.fillStyle = axisColor;
        this.priceCtx.font = '11px monospace';
        this.priceCtx.textAlign = 'right';
        this.priceCtx.textBaseline = 'middle';

        // Right axis border
        this.priceCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim();
        this.priceCtx.lineWidth = 1;
        this.priceCtx.beginPath();
        this.priceCtx.moveTo(this.priceCanvas.width - this.rightAxisWidth, 0);
        this.priceCtx.lineTo(this.priceCanvas.width - this.rightAxisWidth, this.priceChartHeight);
        this.priceCtx.stroke();

        for (let price = minPrice; price <= maxPrice; price += step) {
            const y = this.getPricePixel(price);
            this.priceCtx.fillText(price.toFixed(2), this.priceCanvas.width - 8, y);
        }
    }

    drawTimeAxis(startIdx, endIdx) {
        if (startIdx >= this.data.length) return;

        this.timeAxis.innerHTML = '';
        const timeLabels = this.getTimeLabels(startIdx, endIdx);

        timeLabels.forEach(({ text, index }) => {
            if (index < this.data.length) {
                const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;
                const x = (index - startIdx) * candlePixelWidth - (this.scrollOffset % candlePixelWidth) + this.leftAxisWidth;

                const label = document.createElement('div');
                label.className = 'time-label';
                label.textContent = text;
                label.style.left = x + 'px';
                this.timeAxis.appendChild(label);
            }
        });
    }

    getTimeLabels(startIdx, endIdx) {
        const labels = [];
        const interval = Math.max(1, Math.floor((endIdx - startIdx) / 6));

        for (let i = startIdx; i < endIdx; i += interval) {
            if (i < this.data.length) {
                const date = this.data[i].datetime;
                const text = date.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                labels.push({ text, index: i });
            }
        }

        return labels;
    }

    getPricePixel(price) {
        const range = this.maxPrice - this.minPrice;
        if (range === 0) return this.priceChartHeight / 2;

        const ratio = (price - this.minPrice) / range;
        return this.priceChartHeight - (ratio * (this.priceChartHeight - this.topPadding - this.bottomPadding)) - this.bottomPadding;
    }

    getPrice(pixel) {
        const range = this.maxPrice - this.minPrice;
        const ratio = (this.priceChartHeight - pixel - this.bottomPadding) / (this.priceChartHeight - this.topPadding - this.bottomPadding);
        return this.minPrice + ratio * range;
    }

    getGridStep() {
        const range = this.maxPrice - this.minPrice;
        const maxSteps = Math.floor(this.priceChartHeight / 40);
        const rawStep = range / maxSteps;

        const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
        let step = Math.ceil(rawStep / pow10) * pow10;

        return step;
    }

    getMaxScroll() {
        if (this.data.length === 0) return 0;
        const candlePixelWidth = (this.candleWidth + this.candleGap) * this.zoomLevel;
        return Math.max(0, this.data.length * candlePixelWidth - (this.priceCanvas.width - this.rightAxisWidth) / 2);
    }

    updateScrollbar() {
        const maxScroll = this.getMaxScroll();
        if (maxScroll === 0) {
            this.scrollbarThumb.style.width = '100%';
            this.scrollbarThumb.style.left = '0';
            return;
        }

        const trackWidth = document.querySelector('.scrollbar-track').offsetWidth;
        const thumbWidth = Math.max(30, (this.priceCanvas.width / (this.data.length * (this.candleWidth + this.candleGap) * this.zoomLevel)) * trackWidth);
        const thumbLeft = (this.scrollOffset / maxScroll) * (trackWidth - thumbWidth);

        this.scrollbarThumb.style.width = thumbWidth + 'px';
        this.scrollbarThumb.style.left = thumbLeft + 'px';
    }

    resetView() {
        this.scrollOffset = 0;
        this.zoomLevel = 1;
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.classList.add('active');
    }
}

// ========================================
// INITIALIZATION
// ========================================

let chart;

document.addEventListener('DOMContentLoaded', () => {
    chart = new ChartEngine();
});
