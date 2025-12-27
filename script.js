// --- Tailwind Configuration ---
tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                primary: '#3b82f6',
                secondary: '#8b5cf6',
                dark: {
                    bg: '#0f172a',
                    card: '#1e293b',
                    text: '#f1f5f9',
                    border: '#334155'
                }
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            }
        }
    }
}

// --- Global State ---
let rawData = [];
let rootRefs = {}; // Store chart roots

// --- 1. Google Sheet / CSV Logic ---
function openSheetModal() {
    document.getElementById('sheetModal').classList.remove('hidden');
}
function closeSheetModal() {
    document.getElementById('sheetModal').classList.add('hidden');
}

async function loadSheetData() {
    let url = document.getElementById('sheetUrl').value.trim();
    const rawCsv = document.getElementById('csvPaste').value.trim();
    const btn = document.getElementById('loadBtn');
    const sourceLabel = document.getElementById('data-source-label');
    
    if (!url && !rawCsv) {
        alert("Please provide either a Google Sheet URL or paste CSV data.");
        return;
    }
    
    // Set Loading State
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Loading...`;
    btn.disabled = true;
    sourceLabel.innerText = "Loading data...";

    const resetBtn = () => {
        btn.innerHTML = `Load Data`;
        btn.disabled = false;
    };

    // Helper to clear data on failure
    const clearDataOnFail = () => {
        rawData = [];
        updateDashboard();
        resetBtn();
        closeSheetModal();
    };
    
    // CASE A: Pasted CSV
    if (rawCsv) {
        try {
            parseCSV(rawCsv);
            sourceLabel.innerText = `Source: Pasted CSV Data (${rawData.length} records)`;
            resetBtn();
            closeSheetModal();
        } catch (error) {
            alert(`Error parsing CSV data: ${error.message}`);
            sourceLabel.innerText = "Source: Error parsing CSV";
            clearDataOnFail(); 
        }
        return;
    }

    // CASE B: URL Fetch
    if (url) {
        // Add Cache Buster
        if (url.includes('?')) {
            url += `&t=${Date.now()}`;
        } else {
            url += `?t=${Date.now()}`;
        }

        try {
            // ATTEMPT 1: Direct Fetch
            console.log("Attempting direct fetch...");
            let response = await fetch(url, { method: 'GET', redirect: "follow" });
            
            if (!response.ok) {
                throw new Error(`Direct fetch failed: ${response.status}`);
            }
            
            let text = await response.text();

            // Check if we got HTML instead of CSV (Google auth screen)
            if (text.trim().toLowerCase().startsWith("<!doctype html") || text.includes("<html")) {
                throw new Error("Received HTML instead of CSV. Link might not be published.");
            }

            parseCSV(text);
            sourceLabel.innerText = `Source: Live Google Sheet (${rawData.length} records)`;
            resetBtn();
            closeSheetModal();

        } catch (directError) {
            console.warn("Direct fetch failed, trying proxy...", directError);
            
            // ATTEMPT 2: Proxy Fallback (Fix for CORS/Localhost issues)
            try {
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                let proxyResponse = await fetch(proxyUrl);
                
                if (!proxyResponse.ok) throw new Error(`Proxy fetch failed: ${proxyResponse.status}`);
                
                let proxyText = await proxyResponse.text();
                
                if (!proxyText || proxyText.trim().length === 0) throw new Error("Empty response from Proxy");
                
                parseCSV(proxyText);
                sourceLabel.innerText = `Source: Google Sheet (via Proxy) - ${rawData.length} records`;
                resetBtn();
                closeSheetModal();
                
            } catch (proxyError) {
                alert(`Failed to load Google Sheet.\n\nReason: ${directError.message}\nProxy Reason: ${proxyError.message}\n\nPlease ensure:\n1. File > Share > Publish to web > CSV is selected.\n2. The link is publicly accessible.`);
                console.error("All fetch attempts failed:", proxyError);
                sourceLabel.innerText = "Source: Error loading data";
                clearDataOnFail();
            }
        }
    }
}

function parseCSV(csvText) {
    // 1. Remove Byte Order Mark (BOM)
    if (csvText.charCodeAt(0) === 0xFEFF) {
        csvText = csvText.slice(1);
    }

    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) throw new Error("CSV appears to be empty");
    
    // Helper to parse a CSV line handling quotes
    const parseLine = (text) => {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '"') {
                // Handle escaped quotes ("")
                if (inQuotes && text[i+1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim()); // Keep raw for now
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());
        return values;
    };

    // Parse Headers
    let headers = parseLine(lines[0]);
    
    // Normalize headers
    headers = headers.map(h => h.replace(/^["']|["']$/g, '').replace(/\s+/g, '_'));
    
    console.log('Parsed headers:', headers);

    // Parse Data
    const newData = [];
    for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        if (!line.trim()) continue;
        
        const values = parseLine(line);
        
        // Relaxed length check (allow trailing empty cols)
        if (values.length < 2) continue; 
        
        let obj = {};
        headers.forEach((h, i) => {
            let val = values[i] || "";
            
            // Clean quotes around value
            val = val.replace(/^["']|["']$/g, '');

            // Numeric Conversion
            if (["Expected_Salary", "Years_of_Experience", "Age", "Number_of_Certificates"].includes(h)) {
                let cleanVal = val.replace(/,/g, '').replace(/[^\d.-]/g, '');
                val = parseFloat(cleanVal) || 0;
            }
            obj[h] = val;
        });
        newData.push(obj);
    }

    if (newData.length > 0) {
        rawData = newData;
        
        // Dispose old charts
        Object.values(rootRefs).forEach(root => {
            try { root.dispose(); } catch (e) { console.warn(e); }
        });
        rootRefs = {};
        
        // Reinitialize
        populateFilters();
        initCharts();
        updateDashboard();
        
        // alert(`Successfully loaded ${newData.length} records!`);
    } else {
        throw new Error("No valid data rows found in CSV");
    }
}

// --- 2. Filter Population ---
function populateFilters() {
    if (rawData.length === 0) return;

    const getUnique = (key) => [...new Set(rawData.map(d => d[key]))].sort().filter(x => x);

    // Specialization
    const specs = getUnique("Specialization");
    const specSelect = document.getElementById('specFilter');
    specSelect.innerHTML = '<option value="All">All Specializations</option>';
    specs.forEach(s => specSelect.innerHTML += `<option value="${s}">${s}</option>`);

    // City
    const cities = getUnique("City");
    const citySelect = document.getElementById('cityFilter');
    citySelect.innerHTML = '<option value="All">All Cities</option>';
    cities.forEach(c => citySelect.innerHTML += `<option value="${c}">${c}</option>`);

    // Education (Checkboxes)
    const edus = getUnique("Education_Level");
    const eduContainer = document.getElementById('eduFilterContainer');
    eduContainer.innerHTML = '';
    edus.forEach(e => {
        eduContainer.innerHTML += `
            <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" value="${e}" class="edu-filter form-checkbox rounded text-blue-600 dark:bg-gray-800" checked onchange="updateDashboard()">
                <span class="text-sm text-gray-700 dark:text-gray-300">${e}</span>
            </label>`;
    });

    // Status (Checkboxes)
    const stats = getUnique("Employment_Status");
    const statContainer = document.getElementById('statusFilterContainer');
    statContainer.innerHTML = '';
    stats.forEach(s => {
        statContainer.innerHTML += `
            <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" value="${s}" class="status-filter form-checkbox rounded text-blue-600 dark:bg-gray-800" checked onchange="updateDashboard()">
                <span class="text-sm text-gray-700 dark:text-gray-300">${s}</span>
            </label>`;
    });
}

// --- 3. Sidebar Toggle ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    sidebar.classList.toggle('collapsed');
    
    // Just CSS transform, charts resize automatically usually, but might need invalidation
    setTimeout(() => {
        Object.values(rootRefs).forEach(r => r.resize());
    }, 350);
}

// --- 4. Update Logic ---
function updateDashboard() {
    if (rawData.length === 0) return;

    // Gather Filter Values
    const spec = document.getElementById('specFilter').value;
    const city = document.getElementById('cityFilter').value;
    
    const genders = Array.from(document.querySelectorAll('.gender-filter:checked')).map(cb => cb.value);
    const edus = Array.from(document.querySelectorAll('.edu-filter:checked')).map(cb => cb.value);
    const stats = Array.from(document.querySelectorAll('.status-filter:checked')).map(cb => cb.value);
    
    const maxExp = parseInt(document.getElementById('expRange').value);
    const maxSalary = parseInt(document.getElementById('salaryRange').value);

    // Update Displays
    document.getElementById('expValueDisplay').innerText = maxExp >= 25 ? "All" : `<= ${maxExp} Yrs`;
    document.getElementById('salaryValueDisplay').innerText = maxSalary >= 100000 ? "All" : `<= ${maxSalary.toLocaleString()}`;

    // Filtering
    const filtered = rawData.filter(d => {
        return (spec === "All" || d.Specialization === spec) &&
               (city === "All" || d.City === city) &&
               (genders.includes(d.Gender)) &&
               (edus.includes(d.Education_Level)) &&
               (stats.includes(d.Employment_Status)) &&
               (d.Years_of_Experience <= maxExp) &&
               (d.Expected_Salary <= maxSalary);
    });

    // Update KPIs
    const total = filtered.length;
    document.getElementById('recordCount').innerText = total;
    
    // 1. Total Candidates
    document.getElementById('kpi-total').innerText = total.toLocaleString();

    // 2. Average Expected Salary (from dataset)
    const avgSalary = total > 0 
        ? Math.round(filtered.reduce((sum, d) => sum + (parseFloat(d.Expected_Salary) || 0), 0) / total)
        : 0;
    document.getElementById('kpi-salary').innerText = avgSalary.toLocaleString() + " EGP";

    // 3. Average Years of Experience (from dataset)
    const avgExperience = total > 0
        ? (filtered.reduce((sum, d) => sum + (parseFloat(d.Years_of_Experience) || 0), 0) / total).toFixed(1)
        : 0;
    document.getElementById('kpi-experience').innerText = avgExperience + " Yrs";

    // 4. Employed Candidates (from dataset)
    const employedCount = filtered.filter(d => d.Employment_Status === "Employed").length;
    document.getElementById('kpi-employed').innerText = employedCount.toLocaleString();

    // Update Charts
    updateCharts(filtered, total);
}

function resetFilters() {
    document.getElementById('specFilter').value = "All";
    document.getElementById('cityFilter').value = "All";
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    document.getElementById('expRange').value = 25;
    document.getElementById('salaryRange').value = 100000;
    updateDashboard();
}

// --- 5. Chart Definitions (AmCharts) ---
function initCharts() {
    const isDark = document.documentElement.classList.contains('dark');
    const theme = isDark ? am5themes_Dark : am5themes_Animated;

    // Helper to create root and apply theme
    const createRoot = (id) => {
        let root = am5.Root.new(id);
        root.setThemes([am5themes_Animated.new(root)]);
        if (document.documentElement.classList.contains('dark')) {
            root.setThemes([am5themes_Dark.new(root)]);
        }
        return root;
    };

// 1. Spec Scatter Chart (Bubble Chart Update)
    {
        let root = createRoot("chartSpec");
        rootRefs.chartSpec = root;
        
        let chart = root.container.children.push(am5xy.XYChart.new(root, { 
            panX: true, 
            panY: true, 
            wheelX: "panX", 
            wheelY: "zoomX",
            pinchZoomX: true 
        }));

        // Add Legend/Subtitle inside chart to match the image style
        chart.children.unshift(am5.Label.new(root, {
            text: "Bubble size = Certificates • Color = Specialization",
            fontSize: 12,
            fill: am5.color(0x9ca3af), // gray-400
            x: am5.p0,
            paddingBottom: 10
        }));
        
        let xAxis = chart.xAxes.push(am5xy.ValueAxis.new(root, { 
            renderer: am5xy.AxisRendererX.new(root, {}), 
            tooltip: am5.Tooltip.new(root, {}),
            min: 0,
            maxPrecision: 0
        }));
        xAxis.children.push(am5.Label.new(root, { 
            text: "Years of Experience", 
            x: am5.p50, 
            centerX: am5.p50 
        }));
        
        let yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { 
            renderer: am5xy.AxisRendererY.new(root, {}), 
            tooltip: am5.Tooltip.new(root, {}) 
        }));
        yAxis.children.unshift(am5.Label.new(root, { 
            text: "Expected Salary (EGP)", 
            rotation: -90, 
            y: am5.p50, 
            centerX: am5.p50 
        }));
        
        let series = chart.series.push(am5xy.LineSeries.new(root, { 
            xAxis: xAxis, 
            yAxis: yAxis, 
            valueYField: "salary", 
            valueXField: "experience",
            stroke: am5.color(0x3b82f6),
            fill: am5.color(0x3b82f6),
            calculateAggregates: true
        }));
        
        series.strokes.template.set("strokeWidth", 0);
        
        series.bullets.push(function() { 
            let circle = am5.Circle.new(root, { 
                fill: series.get("fill"),
                fillOpacity: 0.6, // Increased transparency for overlapping bubbles
                stroke: root.interfaceColors.get("background"), 
                strokeWidth: 2,
                tooltipText: "[bold]{specialization}[/]\n─────────────────\n👤 ID: {id}\n📜 Certificates: {certificates}\n💰 Salary: {salary} EGP\n⏱️ Experience: {experience} Yrs"
            });
            
            // --- DYNAMIC BUBBLE SIZE ADAPTER ---
            // This calculates the radius based on number of certificates
            circle.adapters.add("radius", function(radius, target) {
                let dataItem = target.dataItem;
                if (dataItem && dataItem.dataContext) {
                    let certs = dataItem.dataContext.certificates || 0;
                    // Base size 6px + 3.5px per certificate
                    // Example: 0 certs = 6px, 10 certs = 41px
                    return 6 + (certs * 3.5); 
                }
                return 5;
            });
            
            // --- COLOR ADAPTER ---
            circle.adapters.add("fill", function(fill, target) {
                let dataItem = target.dataItem;
                if (dataItem) {
                    let specialization = dataItem.dataContext.specialization;
                    let colors = {
                        "Software Engineer": 0x3b82f6,
                        "Data Scientist": 0x8b5cf6,
                        "Product Manager": 0x10b981,
                        "Sales Representative": 0xf59e0b,
                        "HR Specialist": 0xec4899,
                        "Accountant": 0x06b6d4,
                        "Marketing Manager": 0xf97316,
                        "Civil Engineer": 0x6366f1,
                        "Graphic Designer": 0x14b8a6
                    };
                    return am5.color(colors[specialization] || 0x64748b);
                }
                return fill;
            });
            
            return am5.Bullet.new(root, { sprite: circle }); 
        });
        
        root.series = series;
        root.xAxis = xAxis;
        root.yAxis = yAxis;
    }
    // 2. City Map Chart
    {
        let root = createRoot("chartCity");
        rootRefs.chartCity = root;
        
        let chart = root.container.children.push(am5map.MapChart.new(root, {
            panX: "rotateX",
            panY: "translateY",
            projection: am5map.geoMercator(),
            homeGeoPoint: { latitude: 26.8206, longitude: 30.8025 }
        }));

        let polygonSeries = chart.series.push(am5map.MapPolygonSeries.new(root, {
            geoJSON: am5geodata_egyptLow,
            valueField: "value",
            calculateAggregates: true
        }));

        polygonSeries.mapPolygons.template.setAll({
            tooltipText: "{name}: {value} Candidates"
        });

        polygonSeries.set("heatRules", [{
            target: polygonSeries.mapPolygons.template,
            dataField: "value",
            min: am5.color(0xe0f2fe), // Light Blue
            max: am5.color(0x0284c7), // Dark Blue (Brand color)
            key: "fill"
        }]);

        root.series = polygonSeries;
    }

    // 3. Salary Range Chart (Min/Max/Avg with Insights)
    {
        let root = createRoot("chartSalary");
        rootRefs.chartSalary = root;
        let chart = root.container.children.push(am5xy.XYChart.new(root, { 
            panX: true, 
            panY: false, 
            wheelX: "panX", 
            wheelY: "zoomX"
        }));
        
        let xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 30 });
        xRenderer.labels.template.setAll({ rotation: -45, centerY: am5.p50, centerX: am5.p100 });
        let xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, { categoryField: "category", renderer: xRenderer }));
        let yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { 
            renderer: am5xy.AxisRendererY.new(root, {}),
            title: am5.Label.new(root, { text: "Salary (EGP)", rotation: -90, y: am5.p50 })
        }));
        
        // Average salary as main columns
        let avgSeries = chart.series.push(am5xy.ColumnSeries.new(root, {
            valueYField: "avg",
            categoryXField: "category",
            xAxis: xAxis,
            yAxis: yAxis
        }));
        
        avgSeries.columns.template.setAll({
            strokeWidth: 2,
            fillOpacity: 0.75,
            cornerRadiusTL: 5,
            cornerRadiusTR: 5
        });
        avgSeries.columns.template.adapters.add("fill", (fill, target) => {
            return am5.color(0x3b82f6);
        });
        avgSeries.columns.template.adapters.add("stroke", (stroke, target) => {
            return am5.color(0x2563eb);
        });
        
        // Min markers (green)
        let minSeries = chart.series.push(am5xy.LineSeries.new(root, {
            valueYField: "min",
            categoryXField: "category",
            xAxis: xAxis,
            yAxis: yAxis,
            stroke: am5.color(0x10b981),
            strokeWidth: 0
        }));
        
        minSeries.bullets.push(function() {
            return am5.Bullet.new(root, {
                sprite: am5.Circle.new(root, {
                    radius: 5,
                    fill: am5.color(0x10b981),
                    stroke: root.interfaceColors.get("background"),
                    strokeWidth: 2
                })
            });
        });
        
        // Max markers (orange)
        let maxSeries = chart.series.push(am5xy.LineSeries.new(root, {
            valueYField: "max",
            categoryXField: "category",
            xAxis: xAxis,
            yAxis: yAxis,
            stroke: am5.color(0xf59e0b),
            strokeWidth: 0
        }));
        
        maxSeries.bullets.push(function() {
            return am5.Bullet.new(root, {
                sprite: am5.Circle.new(root, {
                    radius: 5,
                    fill: am5.color(0xf59e0b),
                    stroke: root.interfaceColors.get("background"),
                    strokeWidth: 2
                })
            });
        });
        
        // Enhanced tooltip with all insights
        avgSeries.set("tooltip", am5.Tooltip.new(root, {
            labelText: "[bold]{category}[/]\n━━━━━━━━━━━━━━\n📊 Average: {avg} EGP\n⬇️ Min: {min} EGP\n⬆️ Max: {max} EGP\n📏 Range: {range} EGP\n👥 Count: {count} candidates"
        }));
        
        minSeries.set("tooltip", am5.Tooltip.new(root, {
            labelText: "[bold]{category}[/]\nMinimum Salary: {valueY} EGP"
        }));
        
        maxSeries.set("tooltip", am5.Tooltip.new(root, {
            labelText: "[bold]{category}[/]\nMaximum Salary: {valueY} EGP"
        }));
        
        root.series = [avgSeries, minSeries, maxSeries];
        root.xAxis = xAxis;
    }

    // 4. Line Chart (Certificates vs Avg Salary)
    {
        let root = createRoot("chartCertLine");
        rootRefs.chartCertLine = root;
        let chart = root.container.children.push(am5xy.XYChart.new(root, { panX: true, panY: true, wheelX: "panX", wheelY: "zoomX", pinchZoomX: true }));
        
        let xAxis = chart.xAxes.push(am5xy.ValueAxis.new(root, { 
            renderer: am5xy.AxisRendererX.new(root, {}), 
            tooltip: am5.Tooltip.new(root, {}),
            min: 0,
            maxPrecision: 0
        }));
        xAxis.children.push(am5.Label.new(root, { text: "Number of Certificates", x: am5.p50, centerX: am5.p50 }));
        
        let yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { 
            renderer: am5xy.AxisRendererY.new(root, {}), 
            tooltip: am5.Tooltip.new(root, {}) 
        }));
        yAxis.children.unshift(am5.Label.new(root, { text: "Avg. Salary (EGP)", rotation: -90, y: am5.p50, centerX: am5.p50 }));
        
        let series = chart.series.push(am5xy.LineSeries.new(root, { 
            xAxis: xAxis, 
            yAxis: yAxis, 
            valueYField: "avgSalary", 
            valueXField: "certificates", 
            tooltip: am5.Tooltip.new(root, { labelText: "{valueX} certs: {valueY} EGP" }) 
        }));
        
        series.strokes.template.setAll({ strokeWidth: 3, stroke: am5.color(0xec4899) });
        series.fills.template.setAll({ visible: true, fillOpacity: 0.2, fill: am5.color(0xec4899) });
        
        series.bullets.push(function() { 
            return am5.Bullet.new(root, { 
                sprite: am5.Circle.new(root, { radius: 4, fill: series.get("fill"), stroke: root.interfaceColors.get("background"), strokeWidth: 2 }) 
            }); 
        });
        
        root.series = series;
    }

    // 5. Demographics (Donut Charts)
    ["chartGender", "chartEdu", "chartStatus"].forEach((id, idx) => {
        let root = createRoot(id);
        rootRefs[id] = root;
        let chart = root.container.children.push(am5percent.PieChart.new(root, { 
            layout: root.horizontalLayout, 
            innerRadius: am5.percent(60) 
        }));
        let series = chart.series.push(am5percent.PieSeries.new(root, { valueField: "count", categoryField: "category" }));
        series.labels.template.set("forceHidden", true);
        series.ticks.template.set("visible", false);
        root.series = series;
    });

    // NEW: Heatmap Chart
    {
        let root = createRoot("chartHeatmap");
        rootRefs.chartHeatmap = root;

        let chart = root.container.children.push(am5xy.XYChart.new(root, {
            panX: false,
            panY: false,
            wheelX: "none",
            wheelY: "none",
            layout: root.verticalLayout
        }));

        // X-Axis: Experience Groups
        let xRenderer = am5xy.AxisRendererX.new(root, { 
            minGridDistance: 30
        });
        xRenderer.grid.template.set("visible", false);
        xRenderer.labels.template.setAll({
            centerY: am5.p50,
            centerX: am5.p50,
            paddingTop: 10
        });

        let xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, {
            renderer: xRenderer,
            categoryField: "experienceGroup"
        }));

        // Y-Axis: Specializations
        let yRenderer = am5xy.AxisRendererY.new(root, {
            minGridDistance: 30,
            inversed: true
        });
        yRenderer.grid.template.set("visible", false);

        let yAxis = chart.yAxes.push(am5xy.CategoryAxis.new(root, {
            renderer: yRenderer,
            categoryField: "specialization"
        }));

        // Series: Heatmap Columns
        let series = chart.series.push(am5xy.ColumnSeries.new(root, {
            calculateAggregates: true,
            stroke: am5.color(0xffffff), // White gaps between cells
            clustered: false,
            xAxis: xAxis,
            yAxis: yAxis,
            categoryXField: "experienceGroup",
            categoryYField: "specialization",
            valueField: "avgCert"
        }));

        series.columns.template.setAll({
            tooltipText: "[bold]{categoryY}[/]\n{categoryX}\nAvg Certs: {valueField}",
            strokeOpacity: 0.2,
            strokeWidth: 2,
            width: am5.percent(100),
            height: am5.percent(100),
            cornerRadiusTL: 4,
            cornerRadiusTR: 4,
            cornerRadiusBL: 4,
            cornerRadiusBR: 4
        });
        
        // Dark mode adjustment for borders
        if (document.documentElement.classList.contains('dark')) {
            series.columns.template.set("stroke", am5.color(0x1e293b)); 
        }

        // Heat Rules (Color Gradient: Dark Blue -> Bright Teal)
        series.set("heatRules", [{
            target: series.columns.template,
            min: am5.color(0x1e3a8a), // Dark Blue
            max: am5.color(0x2dd4bf), // Teal
            dataField: "value",
            key: "fill"
        }]);

        // Legend
        let heatLegend = chart.bottomAxesContainer.children.push(am5.HeatLegend.new(root, {
            orientation: "horizontal",
            startColor: am5.color(0x1e3a8a),
            endColor: am5.color(0x2dd4bf),
            stepCount: 5,
            width: am5.percent(100),
            marginTop: 20
        }));

        heatLegend.startLabel.setAll({ fontSize: 12, fill: heatLegend.get("startColor") });
        heatLegend.endLabel.setAll({ fontSize: 12, fill: heatLegend.get("endColor") });

        root.series = series;
        root.xAxis = xAxis;
        root.yAxis = yAxis;
    }

}

function updateCharts(data, total) {
    // Aggregation Helpers
    const getCounts = (key) => {
        const map = {};
        data.forEach(d => map[d[key]] = (map[d[key]] || 0) + 1);
        return Object.keys(map).map(k => ({ category: k, count: map[k] })).sort((a,b) => b.count - a.count);
    };
    
    // 1. Spec Scatter Data
    const scatterData = data.map(d => ({
        id: d.Candidate_ID,
        specialization: d.Specialization,
        experience: parseFloat(d.Years_of_Experience) || 0,
        salary: parseFloat(d.Expected_Salary) || 0,
        city: d.City,
        status: d.Employment_Status,
        education: d.Education_Level,
        gender: d.Gender,
        age: d.Age || 0,
        certificates: d.Number_of_Certificates || 0
    }));
    rootRefs.chartSpec.series.data.setAll(scatterData);

    // 2. City/Governorate Mapping
    const cityToGovernorateMap = {
        "Cairo": "EG-C", "Alexandria": "EG-ALX", "Giza": "EG-GZ",
        "Mansoura": "EG-DK", "Dakahlia": "EG-DK", "Tanta": "EG-GH", "Gharbia": "EG-GH",
        "Zagazig": "EG-SHR", "Sharqia": "EG-SHR", "Banha": "EG-KB", "Qalyubia": "EG-KB",
        "Kafr El Sheikh": "EG-KFS", "Shibin El Kom": "EG-MNF", "Monufia": "EG-MNF",
        "Damanhur": "EG-BH", "Beheira": "EG-BH", "Damietta": "EG-DT", "Port Said": "EG-PTS",
        "Suez": "EG-SUZ", "Ismailia": "EG-IS", "Beni Suef": "EG-BNS", "Fayoum": "EG-FYM",
        "Minya": "EG-MN", "Asyut": "EG-AST", "Sohag": "EG-SHG", "Qena": "EG-KN",
        "Luxor": "EG-LX", "Aswan": "EG-ASN", "Hurghada": "EG-BA", "Red Sea": "EG-BA",
        "Kharga": "EG-WAD", "New Valley": "EG-WAD", "Marsa Matruh": "EG-MT", "Matrouh": "EG-MT",
        "El Arish": "EG-SIN", "North Sinai": "EG-SIN", "Sharm El Sheikh": "EG-JS", "South Sinai": "EG-JS"
    };

    const normalizeCityName = (cityName) => {
        if (!cityName) return null;
        return cityName.trim();
    };

    const allGovernorates = [
        "EG-C", "EG-ALX", "EG-GZ", "EG-DK", "EG-GH", "EG-SHR", "EG-KB", 
        "EG-KFS", "EG-MNF", "EG-BH", "EG-DT", "EG-PTS", "EG-SUZ", "EG-IS", 
        "EG-BNS", "EG-FYM", "EG-MN", "EG-AST", "EG-SHG", "EG-KN", "EG-LX", 
        "EG-ASN", "EG-BA", "EG-WAD", "EG-MT", "EG-SIN", "EG-JS"
    ];
    
    const cityCounts = {};
    allGovernorates.forEach(id => cityCounts[id] = 0);
    
    data.forEach(d => {
        const cityName = normalizeCityName(d.City);
        if (!cityName) return;
        
        let id = cityToGovernorateMap[cityName];
        if (!id) {
            const cityLower = cityName.toLowerCase();
            for (const [key, value] of Object.entries(cityToGovernorateMap)) {
                if (key.toLowerCase() === cityLower) {
                    id = value;
                    break;
                }
            }
        }
        
        if (id && cityCounts.hasOwnProperty(id)) {
            cityCounts[id] = (cityCounts[id] || 0) + 1;
        }
    });
    
    const mapData = allGovernorates.map(id => ({ id: id, value: cityCounts[id] || 0 }));
    rootRefs.chartCity.series.data.setAll(mapData);


    // 3. Salary (Enhanced)
    const getSalaryStats = (catKey, valKey) => {
        const map = {};
        const minMap = {};
        const maxMap = {};
        const countMap = {};
        
        data.forEach(d => {
            const cat = d[catKey];
            const val = parseFloat(d[valKey]) || 0;
            
            if (!map[cat]) {
                map[cat] = 0;
                minMap[cat] = Infinity;
                maxMap[cat] = -Infinity;
                countMap[cat] = 0;
            }
            
            map[cat] += val;
            countMap[cat]++;
            if (val < minMap[cat]) minMap[cat] = val;
            if (val > maxMap[cat]) maxMap[cat] = val;
        });
        
        return Object.keys(map).map(k => {
            const avg = Math.round(map[k] / countMap[k]);
            const min = minMap[k] === Infinity ? 0 : Math.round(minMap[k]);
            const max = maxMap[k] === -Infinity ? 0 : Math.round(maxMap[k]);
            return {
                category: k,
                avg: avg,
                min: min,
                max: max,
                range: max - min,
                count: countMap[k]
            };
        }).sort((a, b) => b.avg - a.avg).slice(0, 10);
    };
    
    const salaryData = getSalaryStats("Specialization", "Expected_Salary");
    rootRefs.chartSalary.series[0].data.setAll(salaryData);
    rootRefs.chartSalary.series[1].data.setAll(salaryData);
    rootRefs.chartSalary.xAxis.data.setAll(salaryData);

    // 4. Line Chart: Certificates
    const certMap = {};
    const certCount = {};
    data.forEach(d => {
        const certs = parseFloat(d.Number_of_Certificates) || 0;
        const salary = parseFloat(d.Expected_Salary) || 0;
        certMap[certs] = (certMap[certs] || 0) + salary;
        certCount[certs] = (certCount[certs] || 0) + 1;
    });
    const certData = Object.keys(certMap).map(c => ({
        certificates: parseInt(c),
        avgSalary: Math.round(certMap[c] / certCount[c])
    })).sort((a,b) => a.certificates - b.certificates);
    rootRefs.chartCertLine.series.data.setAll(certData);

    // 5. Pies
    rootRefs.chartGender.series.data.setAll(getCounts("Gender"));
    rootRefs.chartEdu.series.data.setAll(getCounts("Education_Level"));
    rootRefs.chartStatus.series.data.setAll(getCounts("Employment_Status"));
// --- Heatmap Data Processing ---
    const heatmapMap = {};
    const heatmapCounts = {};
    
    // Define buckets
    const getExpGroup = (yrs) => {
        if (yrs <= 2) return "0-2 years";
        if (yrs <= 5) return "3-5 years";
        if (yrs <= 10) return "6-10 years";
        return "10+ years";
    };

    // Initialize grid to ensure all cells exist (optional, prevents gaps)
    const specs = [...new Set(data.map(d => d.Specialization))];
    const groups = ["0-2 years", "3-5 years", "6-10 years", "10+ years"];
    
    specs.forEach(s => {
        groups.forEach(g => {
            const key = `${s}_${g}`;
            heatmapMap[key] = 0;
            heatmapCounts[key] = 0;
        });
    });

    // Aggregate Data
    data.forEach(d => {
        const group = getExpGroup(parseFloat(d.Years_of_Experience) || 0);
        const spec = d.Specialization;
        const certs = parseFloat(d.Number_of_Certificates) || 0;
        const key = `${spec}_${group}`;
        
        if (heatmapCounts.hasOwnProperty(key)) {
            heatmapMap[key] += certs;
            heatmapCounts[key] += 1;
        }
    });

    // Format for Chart
    const heatmapData = [];
    specs.forEach(s => {
        groups.forEach(g => {
            const key = `${s}_${g}`;
            if (heatmapCounts[key] > 0) {
                heatmapData.push({
                    specialization: s,
                    experienceGroup: g,
                    avgCert: parseFloat((heatmapMap[key] / heatmapCounts[key]).toFixed(1))
                });
            }
        });
    });

    rootRefs.chartHeatmap.series.data.setAll(heatmapData);
    rootRefs.chartHeatmap.xAxis.data.setAll(groups.map(g => ({ experienceGroup: g })));
    rootRefs.chartHeatmap.yAxis.data.setAll(specs.map(s => ({ specialization: s })));
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    if (rawData.length > 0) {
            // Reload charts to apply theme
        Object.values(rootRefs).forEach(root => root.dispose());
        initCharts();
        updateDashboard();
    }
}

// --- Init ---
// Do not auto-load, wait for user input
am5.ready(() => {
    // Charts will be initialized on first data load
});