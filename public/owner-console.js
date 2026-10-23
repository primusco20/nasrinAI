(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const names = {
    overview: ['Good to have you back.', 'A clear view of platform health, AI operations, and business signals.', '◫'],
    ai: ['AI Operations', 'Provider performance, routing, latency, and token usage from verified telemetry.', '✳'],
    users: ['Users & Growth', 'Account totals, usage-based activity, and first-observed retention cohorts.', '♙'],
    infra: ['Infrastructure & Releases', 'Database reachability and connected deployment sources.', '⌘'],
    security: ['Security & Audit', 'Authorization health and minimized owner-action audit events.', '◇'],
    automation: ['Automation & Jobs', 'Workflow health, queue state, retries, and execution outcomes.', '↗'],
    finance: ['Finance & Costs', 'Internal AI cost estimates and gross recorded PayMongo payments, not net revenue.', '▤'],
    incidents: ['Incidents & Alerts', 'Derived signals and the manual incident register; automatic alerts remain pending.', '◎'],
    reports: ['Reports & Exports', 'Date-scoped aggregate reports from verified data sources.', '▥'],
    settings: ['Settings', 'Owner-console access status. Allowlist values remain in Vercel.', '⚙']
  };
  const sources = {
    ai_usage: ['AI usage & tokens', 'Request-level usage events and cost-estimate coverage'],
    users: ['Users & growth', 'Auth record counts and activity signals'],
    retention: ['Usage retention cohorts', 'First-observed signed-in model-call cohorts; not signup cohorts'],
    infrastructure: ['Infrastructure & releases', 'Vercel and dependency health integrations'],
    database: ['Database connection', 'Server-side Supabase reachability check'],
    security_audit: ['Owner action audit events', 'Session and export events only'],
    automation: ['Automation & jobs', 'Aggregate workflow run states'],
    finance: ['Finance & costs', 'Gross recorded PayMongo paid checkouts; excludes refunds, fees, and settlement reconciliation'],
    plan_entitlements: ['Paid plan entitlements', 'Current active Pro/Max/Ultra periods; not revenue'],
    incidents: ['Operational signals', 'Derived failure/stale-job signals and manual incident register; automatic alerts are not connected']
  };
  let data = null;
  let active = 'overview';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function state(label, kind) { return el('span', 'state ' + (kind || 'unavailable'), label); }
  function head(title, desc, label) {
    const h = el('div', 'section-head'), left = el('div');
    left.append(el('h2', '', title), el('p', '', desc));
    h.append(left, state(label || 'Read-only', ''));
    return h;
  }
  function metric(title, icon, value, note) {
    const card = el('article', 'metric'), top = el('div', 'metric-top');
    top.append(el('span', '', title), el('span', 'metric-icon', icon));
    card.append(top, el('div', 'metric-value', value), el('div', 'metric-note', note));
    return card;
  }
  function numberText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : 'Unavailable';
  }
  function moneyText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? '~' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n) : 'Unavailable';
  }
  function notice(title, copy) {
    const n = el('div', 'notice'), body = el('div');
    n.append(el('div', 'notice-icon', 'i'));
    body.append(el('strong', '', title), el('p', '', copy));
    n.append(body);
    return n;
  }
  function sourceRows() {
    const list = el('div', 'source-list');
    Object.keys(sources).forEach((key) => {
      const row = el('div', 'source-row'), left = el('div');
      const current = data && data.data_sources ? data.data_sources[key] : 'unavailable';
      left.append(el('div', 'source-name', sources[key][0]), el('div', 'source-detail', sources[key][1]));
      row.append(left, state(current === 'available' ? 'Available' : current === 'no_data' ? 'No data yet' : 'Unavailable', current === 'available' ? 'available' : 'unavailable'));
      list.append(row);
    });
    return list;
  }
  function renderOverview() {
    const c = $('content'), u = data && data.usage_24h, userSummary = data && data.user_summary;
    const hasUsage = Boolean(u), requests = hasUsage ? Number(u.request_count) : NaN;
    const noData = hasUsage && requests === 0;
    c.replaceChildren();
    c.append(notice(hasUsage ? 'Usage telemetry is connected' : 'Telemetry connections are not verified yet',
      hasUsage
        ? 'AI usage metrics are aggregated from server-side events. Cost values are internal estimates, not provider invoices. Auth account/sign-in aggregates and usage-based active IDs are shown only from their verified sources. Infrastructure/release telemetry requires the optional Vercel read-only source; platform-wide security events beyond owner actions, settled billing/revenue reconciliation, automatic incident generation, and alert delivery remain unavailable until their sources are verified.'
        : 'The secure console is in place, but this view deliberately does not invent metrics. Each panel shows real figures only after its server-side source, definitions, and access checks are verified.'));
    c.append(head('Platform snapshot', 'Last 24 hours · recorded model-call telemetry only.', 'Read-only'));
    const grid = el('div', 'grid');
    const requestValue = !hasUsage ? 'Unavailable' : noData ? 'No data yet' : numberText(requests);
    const successValue = !hasUsage ? 'Unavailable' : noData ? 'No data yet' : requests > 0 ? (Number(u.success_count) / requests * 100).toFixed(1) + '%' : 'No data yet';
    const activeValue = !hasUsage ? 'Unavailable' : noData ? 'No data yet' : numberText(u.active_user_ids);
    const tokenValue = !hasUsage ? 'Unavailable' : noData ? 'No data yet' : numberText(u.total_tokens);
    const costValue = !hasUsage || Number(u.cost_estimate_rows) === 0 ? 'Unavailable' : moneyText(u.estimated_cost_usd);
    const latencyValue = !hasUsage || u.latency_p95_ms === null || u.latency_p95_ms === undefined ? 'Unavailable' : numberText(Math.round(Number(u.latency_p95_ms))) + ' ms';
    grid.append(
      metric('AI requests', '✳', requestValue, 'Recorded model-call events'),
      metric('Success rate', '✓', successValue, 'Successful outcomes / recorded requests'),
      metric('Active user IDs', '♙', activeValue, 'Distinct signed-in IDs with calls'),
      metric('Auth user records', '♧', userSummary ? numberText(userSummary.auth_user_records) : 'Unavailable', 'Aggregate count only; no user IDs or emails returned'),
      metric('Tokens recorded', '↗', tokenValue, 'Input plus output tokens'),
      metric('Estimated AI cost', 'USD', costValue, Number(u && u.cost_estimate_rows) > 0 ? 'Internal estimate; not an invoice' : 'No cost estimates recorded'),
      metric('p95 latency', '◷', latencyValue, 'Successful-call latency, when observations exist')
    );
    c.append(grid);
    const lower = el('div', 'lower-grid'), readiness = el('section', 'panel'), statusPanel = el('section', 'panel');
    readiness.append(el('h3', '', 'Data-source readiness'), el('p', 'panel-copy', 'A source is marked available only when its server-side query succeeds. No placeholder zeros are shown.'), sourceRows());
    statusPanel.append(el('h3', '', 'Implementation status'), el('p', 'panel-copy', 'The owner access boundary and responsive shell are implemented. Usage, automation, and owner-action audit summaries require migration 057 to be applied and verified. Other panels remain unavailable until their source and permission boundaries are audited.'));
    const list = el('div', 'source-list');
    [
      ['Owner identity & IP allowlist', 'Server-only Vercel environment variables', 'Guard implemented'],
      ['Short-lived owner session', 'HttpOnly cookie with strict same-site policy', 'Guard implemented'],
      ['Usage and automation summaries', 'Aggregate RPCs; no prompts or workflow payloads', 'Migration required'],
      ['Broader operational sources', 'Account cohorts, releases, finance, incidents and alerts', 'Pending']
    ].forEach((item) => {
      const row = el('div', 'source-row'), left = el('div');
      left.append(el('div', 'source-name', item[0]), el('div', 'source-detail', item[1]));
      row.append(left, state(item[2], item[2] === 'Pending' ? 'unavailable' : 'available'));
      list.append(row);
    });
    statusPanel.append(list);
    lower.append(readiness, statusPanel);
    c.append(lower);
    if (hasUsage && u.last_event_at) $('freshness').textContent = 'Last usage event ' + new Date(u.last_event_at).toLocaleString() + ' · estimates may be partial';
  }
  function renderModule(key) {
    const c = $('content'), meta = names[key];
    c.replaceChildren();
    c.append(head(meta[0], meta[1], 'Read-only'), notice('No unverified data is shown', 'This module remains read-only. Data without a verified source is marked Unavailable rather than represented by fabricated counts or stale values.'));
    const sourceKeys = key === 'ai' ? ['ai_usage', 'infrastructure'] :
      key === 'users' ? ['users', 'retention'] :
      key === 'infra' ? ['database', 'infrastructure'] :
      key === 'security' ? ['security_audit'] :
      key === 'automation' ? ['automation'] :
      key === 'finance' ? ['finance', 'ai_usage'] :
      key === 'incidents' ? ['incidents', 'security_audit'] :
      key === 'reports' ? ['ai_usage', 'users', 'finance'] :
      ['security_audit', 'infrastructure'];
    const cards = el('div', 'module-grid');
    sourceKeys.forEach((sourceKey) => {
      const source = sources[sourceKey], card = el('article', 'module-card'), body = el('div');
      const current = data && data.data_sources ? data.data_sources[sourceKey] : 'unavailable';
      const label = current === 'available' ? 'Available' : current === 'no_data' ? 'No data yet' : current === 'stale' ? 'Stale' : 'Unavailable';
      const kind = current === 'available' ? 'available' : current === 'stale' ? 'stale' : 'unavailable';
      card.append(el('div', 'module-symbol', meta[2]));
      body.append(el('h3', '', source[0]), el('p', '', source[1] + '. Status is based on the last server-side check.'));
      const foot = el('div', 'module-meta');
      foot.append(state(label, kind), el('small', '', current === 'available' ? 'Source connected' : current === 'no_data' ? 'Connected; no matching records' : current === 'stale' ? 'Refresh required' : 'No verified source'));
      body.append(foot);
      card.append(body);
      cards.append(card);
    });
    c.append(cards);

    if (key === 'ai') {
      const usage = data && data.usage_24h;
      const providers = data && data.usage_7d && Array.isArray(data.usage_7d.providers) ? data.usage_7d.providers : [];
      const features = data && data.usage_7d && Array.isArray(data.usage_7d.features) ? data.usage_7d.features : [];
      const panel = el('section', 'panel');
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Recorded AI activity'), el('p', 'panel-copy', 'Usage events contain aggregate telemetry only; cost values are internal estimates.'));
      const grid = el('div', 'grid');
      grid.append(
        metric('Requests · 24h', '✳', usage ? numberText(usage.request_count) : 'Unavailable', 'Recorded model calls'),
        metric('Tokens · 24h', '↗', usage ? numberText(usage.total_tokens) : 'Unavailable', 'Input plus output tokens'),
        metric('Success rate', '✓', usage && Number(usage.request_count) > 0 ? (Number(usage.success_count) / Number(usage.request_count) * 100).toFixed(1) + '%' : 'No data yet', 'Recorded successful outcomes'),
        metric('p95 latency', '◷', usage && usage.latency_p95_ms !== null && usage.latency_p95_ms !== undefined ? numberText(Math.round(Number(usage.latency_p95_ms))) + ' ms' : 'Unavailable', 'Successful calls')
      );
      panel.append(grid);
      const list = el('div', 'source-list');
      if (providers.length) {
        providers.forEach((item) => {
          const row = el('div', 'source-row'), left = el('div');
          left.append(el('div', 'source-name', item.provider + ' / ' + item.model), el('div', 'source-detail', numberText(item.requests) + ' requests · ' + numberText(Number(item.input_tokens) + Number(item.output_tokens)) + ' tokens'));
          row.append(left, el('div', 'source-name', moneyText(item.estimated_cost_usd)));
          list.append(row);
        });
      } else list.append(el('p', 'panel-copy', 'Provider breakdown unavailable until usage telemetry is connected.'));
      panel.append(list);
      c.append(panel);

      const featurePanel = el('section', 'panel');
      featurePanel.classList.add('module-extra');
      featurePanel.append(head('Feature activity · 7d', 'Fixed server-side usage categories; this is activity, not signup conversion or net revenue.', features.length ? 'Available' : 'No data yet'));
      const featureList = el('div', 'source-list');
      if (features.length) {
        features.forEach((item) => {
          const row = el('div', 'source-row'), left = el('div');
          left.append(
            el('div', 'source-name', String(item.feature || 'other').replace(/_/g, ' ')),
            el('div', 'source-detail', numberText(item.active_user_ids) + ' signed-in IDs · ' + numberText(item.active_guest_ids) + ' guest IDs · ' + numberText(item.total_tokens) + ' tokens')
          );
          row.append(left, el('div', 'source-name', numberText(item.requests) + ' requests'));
          featureList.append(row);
        });
      } else {
        featureList.append(el('p', 'panel-copy', 'Feature activity is unavailable until usage telemetry contains matching events.'));
      }
      featurePanel.append(featureList);
      c.append(featurePanel);
    }

    if (key === 'users') {
      const a = data && data.usage_24h, b = data && data.usage_7d, users = data && data.user_summary, growth = data && data.growth_summary, retention = data && data.retention_summary, panel = el('section', 'panel');
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Account and activity signals'), el('p', 'panel-copy', 'Auth record totals and signup timestamps are aggregated server-side. Activity IDs reflect recorded model calls; retention cohorts use the first observed signed-in model-call date within a 45-day lookback, not signup date.'));
      const grid = el('div', 'grid');
      const value = (summary, field) => !summary ? 'Unavailable' : Number(summary.request_count) === 0 ? 'No data yet' : numberText(summary[field]);
      grid.append(
        metric('Auth user records', '♧', users ? numberText(users.auth_user_records) : 'Unavailable', 'Aggregate count; no user identifiers returned'),
        metric('New Auth records · 24h', '↗', users ? numberText(users.new_auth_records_24h) : 'Unavailable', 'Records created in the last day'),
        metric('New Auth records · 7d', '↗', users ? numberText(users.new_auth_records_7d) : 'Unavailable', 'Records created in the last week'),
        metric('Sign-ins · 30d', '◷', users ? numberText(users.active_signins_30d) : 'Unavailable', 'Auth records with a recent sign-in'),
        metric('Active users · 24h', '♙', growth ? numberText(growth.active_user_ids_24h) : 'Unavailable', 'Distinct actors with recorded calls'),
        metric('Active users · 7d', '♙', growth ? numberText(growth.active_user_ids_7d) : 'Unavailable', 'Distinct actors with recorded calls'),
        metric('Active users · 30d', '♙', growth ? numberText(growth.active_user_ids_30d) : 'Unavailable', 'Distinct actors with recorded calls'),
        metric('Active guests · 24h', '◌', growth ? numberText(growth.active_guest_ids_24h) : 'Unavailable', 'Distinct guest actors with recorded calls'),
        metric('7d return rate', '↻', growth && growth.return_rate_pct !== null ? Number(growth.return_rate_pct).toFixed(1) + '%' : growth ? 'No cohort yet' : 'Unavailable', 'Prior-week active users who returned this week'),
        metric('Active user IDs · 24h', '♙', value(a, 'active_user_ids'), 'Signed-in actors with recorded calls'),
        metric('Active guest IDs · 24h', '◌', value(a, 'active_guest_ids'), 'Guest actors with recorded calls'),
        metric('Active user IDs · 7d', '♙', value(b, 'active_user_ids'), 'Distinct signed-in actors'),
        metric('Active guest IDs · 7d', '◌', value(b, 'active_guest_ids'), 'Distinct guest actors')
      );
      panel.append(grid);
      c.append(panel);

      const cohorts = Array.isArray(retention?.cohorts) ? retention.cohorts.slice(0, 7) : [];
      const cohortPanel = el('section', 'panel');
      cohortPanel.classList.add('module-extra');
      cohortPanel.append(head('Usage-based retention cohorts', 'First-observed signed-in model-call cohorts · 45-day lookback · last 14 days', retention ? (cohorts.length ? 'Available' : 'No data yet') : 'Unavailable'));
      cohortPanel.append(el('p', 'panel-copy', 'Day 1 and day 7 retention count a model call on exactly cohort date + 1 or + 7. Newer cohorts are not eligible for day 7 yet. These are activity cohorts, not signup cohorts. Older activity outside the 45-day lookback is not used to establish a cohort.'));
      if (cohorts.length) {
        const cohortGrid = el('div', 'grid');
        cohorts.forEach((cohort) => {
          const d1 = cohort.day_1_retention_pct == null ? 'Not eligible' : Number(cohort.day_1_retention_pct).toFixed(1) + '%';
          const d7 = cohort.day_7_retention_pct == null ? 'Not eligible' : Number(cohort.day_7_retention_pct).toFixed(1) + '%';
          const d1Count = numberText(cohort.day_1_returned) + '/' + numberText(cohort.day_1_eligible);
          const d7Count = numberText(cohort.day_7_returned) + '/' + numberText(cohort.day_7_eligible);
          cohortGrid.append(metric('Cohort ' + cohort.cohort_date, '♙', numberText(cohort.cohort_size), 'D1 ' + d1 + ' (' + d1Count + ') · D7 ' + d7 + ' (' + d7Count + ')'));
        });
        cohortPanel.append(cohortGrid);
      } else {
        cohortPanel.append(notice(retention ? 'No cohort data yet' : 'Retention source unavailable', 'Cohorts appear after signed-in users have recorded model-call activity in the selected window.'));
      }
      c.append(cohortPanel);
    }

    if (key === 'infra') {
      const panel = el('section', 'panel'), db = data && data.database_health ? data.database_health.status : 'unavailable';
      const deployments = data && data.deployment_summary;
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Database reachability'), el('p', 'panel-copy', 'This is a bounded server-side connectivity check; it does not expose database rows.'));
      panel.append(state(db === 'available' ? 'Available' : 'Unavailable', db === 'available' ? 'available' : 'unavailable'));
      panel.append(el('h3', '', 'Recent production deployments'), el('p', 'panel-copy', 'Read-only Vercel metadata. This integration requires a dedicated read-only token and project identifiers; missing credentials are shown as unavailable.'));
      if (!deployments) {
        panel.append(notice('Deployment source unavailable', 'Set OWNER_VERCEL_READONLY_TOKEN, OWNER_VERCEL_PROJECT_ID, and OWNER_VERCEL_TEAM_ID on the server to connect this read-only source.'));
      } else {
        const grid = el('div', 'grid');
        grid.append(
          metric('Deployments returned', '⌘', numberText(deployments.deployment_count), 'Latest production deployments'),
          metric('Ready', '✓', numberText(deployments.ready_count), 'State reported by Vercel'),
          metric('Failed or canceled', '!', numberText(deployments.failed_count), 'Error/canceled states reported by Vercel')
        );
        panel.append(grid);
        const list = el('div', 'source-list');
        (Array.isArray(deployments.deployments) ? deployments.deployments : []).forEach((item) => {
          const row = el('div', 'source-row'), left = el('div'), status = String(item.state || 'unknown');
          left.append(el('div', 'source-name', item.url || 'Deployment URL unavailable'), el('div', 'source-detail', [item.branch || 'branch unknown', item.commit ? item.commit.slice(0, 12) : 'commit unknown', item.created_at ? new Date(item.created_at).toLocaleString() : 'time unknown'].join(' · ')));
          row.append(left, state(status.toUpperCase(), status === 'ready' ? 'available' : ['error','canceled','cancelled'].includes(status) ? 'unavailable' : ''));
          list.append(row);
        });
        panel.append(list);
      }
      c.append(panel);
    }

    if (key === 'finance') {
      const usage = data && data.usage_24h, plans = data && data.plans_24h, hasCosts = Boolean(usage && Number(usage.cost_estimate_rows) > 0), panel = el('section', 'panel');
      const paidByCurrency = Array.isArray(plans?.gross_paid_by_currency) ? plans.gross_paid_by_currency : [];
      const phpPaid = paidByCurrency.find((item) => item && item.currency === 'PHP');
      const paidPaymentCount = plans && Number.isFinite(Number(plans.paid_payment_count)) ? Number(plans.paid_payment_count) : null;
      const grossPhp = plans ? '₱' + (Number(phpPaid?.gross_amount_minor || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Unavailable';
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Recorded AI cost estimates'), el('p', 'panel-copy', 'These are internal estimates recorded with model calls, not provider invoices, settled payments, revenue, refunds, or net margin.'));
      const grid = el('div', 'grid');
      grid.append(
        metric('Estimated AI cost · 24h', 'USD', hasCosts ? moneyText(usage.estimated_cost_usd) : 'Unavailable', hasCosts ? 'Recorded cost estimates only' : 'No recorded cost estimates'),
        metric('Requests with cost', '▤', hasCosts ? numberText(usage.cost_estimate_rows) : 'Unavailable', 'Usage events with an estimate'),
        metric('Requests · 24h', '✳', usage ? numberText(usage.request_count) : 'Unavailable', 'Recorded usage events'),
        metric('Active paid plan periods', '◇', plans ? numberText(plans.active_paid_periods) : 'Unavailable', 'Unexpired active periods, not unique users'),
        metric('Pro periods', 'P', plans ? numberText(plans.active_pro_periods) : 'Unavailable', 'Current active Pro periods'),
        metric('Max periods', 'M', plans ? numberText(plans.active_max_periods) : 'Unavailable', 'Current active Max periods'),
        metric('Ultra periods', 'U', plans ? numberText(plans.active_ultra_periods) : 'Unavailable', 'Current active Ultra periods'),
        metric('Recorded PayMongo gross · 24h', 'PHP', grossPhp, 'Recorded paid checkout amounts before fees and refunds'),
        metric('Recorded paid checkouts · 24h', '#', paidPaymentCount === null ? 'Unavailable' : numberText(paidPaymentCount), 'PayMongo paid periods recorded in the selected window')
      );
      panel.append(grid, el('p', 'panel-copy', 'PayMongo gross amounts are derived only from recorded paid checkout periods. They are not net revenue: refunds, disputes, processor fees, settlement timing, and unrecorded adjustments are not represented.'));
      c.append(panel);
    }

    if (key === 'incidents') {
      const signals = data && data.incidents_24h, panel = el('section', 'panel');
      panel.classList.add('module-extra');
      const failedAi = signals ? Number(signals.ai_failed_requests || 0) : null;
      const failedJobs = signals ? Number(signals.automation_failed_runs || 0) : null;
      const staleJobs = signals ? Number(signals.stale_running_runs || 0) : null;
      const hasSignals = signals && (failedAi + failedJobs + staleJobs > 0);
      panel.append(head('Derived operational signals', 'Last 24 hours of recorded model-call failures and automation-run health.', hasSignals ? 'Attention' : signals ? 'No signals' : 'Unavailable'));
      panel.append(el('p', 'panel-copy', 'These are read-only signals derived from existing telemetry. They do not automatically create incidents, send notifications, or perform remediation.'));
      const grid = el('div', 'grid');
      grid.append(
        metric('Failed AI requests', '✳', signals ? numberText(failedAi) : 'Unavailable', 'Recorded outcomes other than ok'),
        metric('Failed automation runs', '↗', signals ? numberText(failedJobs) : 'Unavailable', 'Failed executions in the selected window'),
        metric('Stale running jobs', '◷', signals ? numberText(staleJobs) : 'Unavailable', 'Running over 30 minutes')
      );
      panel.append(grid);
      if (signals && signals.last_failure_at) panel.append(el('p', 'panel-copy', 'Most recent failure: ' + new Date(signals.last_failure_at).toLocaleString()));
      if (signals && !hasSignals) panel.append(el('p', 'panel-copy', 'No matching failures or stale runs were recorded in this window.'));
      c.append(panel);

      const manager = el('section', 'panel');
      manager.classList.add('module-extra');
      manager.append(el('h3', '', 'Incident register'), el('p', 'panel-copy', 'Create and track operational incidents. All changes require explicit confirmation and are recorded in the owner audit trail. This register does not deliver alerts.'));
      const form = el('form', 'incident-form');
      const titleLabel = el('label', '', 'Incident title'), titleInput = el('input');
      titleInput.name = 'title'; titleInput.maxLength = 160; titleInput.required = true; titleInput.placeholder = 'Short, actionable summary';
      titleLabel.append(titleInput);
      const descriptionLabel = el('label', '', 'Description'), descriptionInput = el('textarea');
      descriptionInput.name = 'description'; descriptionInput.maxLength = 1200; descriptionInput.rows = 3; descriptionInput.placeholder = 'Context without secrets or private user content';
      descriptionLabel.append(descriptionInput);
      const severityLabel = el('label', '', 'Severity'), severityInput = el('select');
      [['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].forEach(([value,label]) => { const option = el('option','',label); option.value = value; severityInput.append(option); });
      severityInput.name = 'severity'; severityLabel.append(severityInput);
      const sourceLabel = el('label', '', 'Source'), sourceInput = el('select');
      [['manual','Manual'],['ai_usage','AI usage'],['automation','Automation'],['infrastructure','Infrastructure'],['security','Security']].forEach(([value,label]) => { const option = el('option','',label); option.value = value; sourceInput.append(option); });
      sourceInput.name = 'source'; sourceLabel.append(sourceInput);
      const submit = el('button', 'quiet-button', 'Create incident'); submit.type = 'submit';
      const message = el('p', 'panel-copy', 'Incidents are private to the owner console. Do not include credentials, prompts, or unnecessary personal data.');
      form.append(titleLabel, descriptionLabel, severityLabel, sourceLabel, submit, message);
      const register = el('div', 'incident-register');
      manager.append(form, register);
      c.append(manager);

      async function refreshIncidents() {
        register.replaceChildren(el('p', 'panel-copy', 'Loading incident records…'));
        try {
          const response = await fetch('/owner/api/incidents', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
          if (response.status === 404) { window.location.href = 'https://www.nasrinai.com/'; return; }
          if (!response.ok) throw new Error('incident list unavailable');
          const payload = await response.json();
          register.replaceChildren();
          const counts = payload.counts || {};
          const countGrid = el('div', 'grid');
          countGrid.append(
            metric('Open', '!', numberText(counts.open || 0), 'Needs attention'),
            metric('Acknowledged', '✓', numberText(counts.acknowledged || 0), 'Owner has acknowledged'),
            metric('Resolved', '✓', numberText(counts.resolved || 0), 'Resolution recorded'),
            metric('Critical open', '⚠', numberText(counts.critical_open || 0), 'Open critical incidents')
          );
          register.append(countGrid);
          const items = Array.isArray(payload.incidents) ? payload.incidents : [];
          if (!items.length) register.append(notice('No incidents recorded', 'Create an incident above when an operational issue needs a durable owner record.'));
          const list = el('div', 'source-list');
          items.forEach((item) => {
            const row = el('article', 'incident-item'), body = el('div', 'incident-item-body'), top = el('div', 'incident-item-top');
            top.append(el('strong', '', item.title || 'Untitled incident'), state(String(item.severity || 'unknown').toUpperCase(), item.severity === 'critical' || item.severity === 'high' ? 'unavailable' : ''));
            body.append(top, el('p', 'panel-copy', item.description || 'No description provided.'));
            body.append(el('p', 'source-detail', [String(item.source || 'manual'), String(item.status || 'open'), item.created_at ? new Date(item.created_at).toLocaleString() : 'time unknown'].join(' · ')));
            if (item.resolution_note) body.append(el('p', 'panel-copy', 'Resolution: ' + item.resolution_note));
            const actions = el('div', 'incident-actions');
            async function changeStatus(action) {
              const resolutionNote = action === 'resolve' ? window.prompt('Add a resolution note (3–1200 characters):') : '';
              if (action === 'resolve' && (typeof resolutionNote !== 'string' || resolutionNote.trim().length < 3 || resolutionNote.trim().length > 1200)) return;
              const confirmation = action === 'acknowledge' ? 'Acknowledge this incident?' : 'Resolve this incident with the provided note?';
              if (!window.confirm(confirmation)) return;
              try {
                const response = await fetch('/owner/api/incidents/' + encodeURIComponent(item.id) + '/' + action, {
                  method: 'POST', credentials: 'same-origin', cache: 'no-store',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: JSON.stringify({ confirm: action === 'acknowledge' ? 'ACKNOWLEDGE' : 'RESOLVE', resolution_note: resolutionNote || '' })
                });
                if (response.status === 404) { window.location.href = 'https://www.nasrinai.com/'; return; }
                if (!response.ok) throw new Error('incident update failed');
                await refreshIncidents();
              } catch {
                register.prepend(notice('Update failed', 'The incident could not be updated. Refresh the list and try again.'));
              }
            }
            if (item.status === 'open') {
              const acknowledge = el('button', 'quiet-button', 'Acknowledge'); acknowledge.type = 'button';
              acknowledge.addEventListener('click', () => changeStatus('acknowledge')); actions.append(acknowledge);
            }
            if (item.status !== 'resolved') {
              const resolve = el('button', 'quiet-button', 'Resolve'); resolve.type = 'button';
              resolve.addEventListener('click', () => changeStatus('resolve')); actions.append(resolve);
            }
            row.append(body, actions); list.append(row);
          });
          register.append(list);
        } catch {
          register.replaceChildren(notice('Incident storage unavailable', 'Apply and verify migration 057 before using the incident register. No changes were made.'));
        }
      }
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!window.confirm('Create a durable incident record? This does not send a notification.')) return;
        submit.disabled = true;
        try {
          const response = await fetch('/owner/api/incidents', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ confirm: 'CREATE INCIDENT', title: titleInput.value, description: descriptionInput.value, severity: severityInput.value, source: sourceInput.value })
          });
          if (response.status === 404) { window.location.href = 'https://www.nasrinai.com/'; return; }
          if (!response.ok) throw new Error('incident create failed');
          form.reset();
          await refreshIncidents();
        } catch {
          register.prepend(notice('Incident could not be recorded', 'Incident storage may be unavailable until migration 057 is applied and verified.'));
        } finally {
          submit.disabled = false;
        }
      });
      void refreshIncidents();
    }

    if (key === 'security') {
      const panel = el('section', 'panel'), audit = data && data.audit_24h, platformAudit = data && data.platform_auth_audit_24h;
      const platformReady = Boolean(platformAudit && platformAudit.available === true);
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Access boundary'), el('p', 'panel-copy', 'The current page is visible only after server-side email/IP validation. Allowlist values and the signing secret are never returned to the browser.'));
      const rows = el('div', 'source-list');
      [
        ['Owner session', '10-minute HttpOnly, SameSite=Strict cookie', 'Enabled'],
        ['Email and IP validation', 'Rechecked on protected requests', 'Enabled'],
        ['Shared IP rate limit', 'Uses the existing server-side limiter', 'Enabled'],
        ['Owner action audit history', 'Session, export, and incident actions; raw IP values are not returned', audit ? (Number(audit.event_count) > 0 ? 'Available' : 'No data yet') : 'Unavailable'],
        ['Platform Auth audit source', 'Aggregate Supabase Auth event categories only; no email, IP, actor IDs, or raw payloads', platformReady ? (Number(platformAudit.event_count) > 0 ? 'Available' : 'No data yet') : 'Unavailable']
      ].forEach((item) => {
        const row = el('div', 'source-row'), left = el('div');
        left.append(el('div', 'source-name', item[0]), el('div', 'source-detail', item[1]));
        row.append(left, state(item[2], item[2] === 'Enabled' || item[2] === 'Available' ? 'available' : 'unavailable'));
        rows.append(row);
      });
      panel.append(rows);
      const grid = el('div', 'grid');
      grid.append(
        metric('Owner audit events · 24h', '◇', audit ? numberText(audit.event_count) : 'Unavailable', audit && audit.last_event_at ? 'Last event ' + new Date(audit.last_event_at).toLocaleString() : 'No audit events recorded'),
        metric('Platform Auth events · 24h', '⌁', platformReady ? numberText(platformAudit.event_count) : 'Unavailable', platformReady && platformAudit.last_event_at ? 'Last event ' + new Date(platformAudit.last_event_at).toLocaleString() : platformReady ? 'No Auth audit events recorded' : 'Auth audit source unavailable'),
        metric('Sign-in events', '↗', platformReady ? numberText(platformAudit.sign_in_events) : 'Unavailable', 'Coarse event categories only'),
        metric('Account recovery events', '◇', platformReady ? numberText(platformAudit.account_recovery_events) : 'Unavailable', 'No identities or recovery payloads returned'),
        metric('Password change events', '⚿', platformReady ? numberText(platformAudit.password_change_events) : 'Unavailable', 'Aggregate event count'),
        metric('Sign-out events', '↙', platformReady ? numberText(platformAudit.sign_out_events) : 'Unavailable', 'Aggregate event count')
      );
      panel.append(grid);
      c.append(panel);
    }

    if (key === 'automation') {
      const summary = data && data.automation_24h, ready = Boolean(summary), noData = ready && Number(summary.run_count) === 0, panel = el('section', 'panel');
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Automation run health · 24 hours'), el('p', 'panel-copy', 'Aggregate run states only; workflow definitions, step arguments, and payloads are not returned.'));
      const grid = el('div', 'grid');
      grid.append(
        metric('Runs', '↗', !ready ? 'Unavailable' : noData ? 'No data yet' : numberText(summary.run_count), 'Recorded automation runs'),
        metric('Pending approval', '◷', !ready ? 'Unavailable' : numberText(summary.pending_approval_count), 'Awaiting explicit approval'),
        metric('Running', '↻', !ready ? 'Unavailable' : numberText(summary.running_count), 'Currently running'),
        metric('Failed', '!', !ready ? 'Unavailable' : numberText(summary.failed_count), 'Failed executions'),
        metric('Stale running', '⚠', !ready ? 'Unavailable' : numberText(summary.stale_running_count), 'Running for more than 30 minutes')
      );
      panel.append(grid);
      c.append(panel);
    }

    if (key === 'reports') {
      const panel = el('section', 'panel');
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Export verified usage summaries'), el('p', 'panel-copy', 'Exports contain aggregate counts and provider/model totals only. They never include prompts, message content, credentials, or user-level records.'));
      const actions = el('div', 'module-meta');
      [['24-hour CSV', '/owner/api/export?window=24h'], ['7-day CSV', '/owner/api/export?window=7d']].forEach((item) => {
        const link = el('a', 'quiet-button', item[0]);
        link.href = item[1];
        link.setAttribute('download', '');
        actions.append(link);
      });
      panel.append(actions);
      c.append(panel);
    }

    if (key === 'settings') {
      const panel = el('section', 'panel');
      panel.classList.add('module-extra');
      panel.append(el('h3', '', 'Access configuration'), el('p', 'panel-copy', 'Manage OWNER_ALLOWED_EMAILS, OWNER_ALLOWED_IPS, and OWNER_SESSION_SECRET in Vercel Project → Settings → Environment Variables. Changes apply after redeploy. The console never displays the allowlist or session secret.'));
      c.append(panel);
    }
  }
  function show(key) {
    active = names[key] ? key : 'overview';
    const meta = names[active];
    $('page-title').textContent = meta[0];
    $('page-description').textContent = meta[1];
    $('crumb').textContent = active === 'overview' ? 'Overview' : meta[0];
    document.querySelectorAll('.nav-item').forEach((button) => {
      const selected = button.dataset.panel === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    });
    if (active === 'overview') renderOverview();
    else renderModule(active);
  }
  async function refresh() {
    $('freshness').textContent = 'Checking data sources…';
    try {
      const response = await fetch('/owner/api/overview', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (response.status === 404) { window.location.href = 'https://www.nasrinai.com/'; return; }
      if (!response.ok) throw new Error('refresh failed');
      data = await response.json();
      $('freshness').textContent = 'Checked ' + new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · sources pending';
      show(active);
    } catch {
      $('freshness').textContent = 'Could not refresh';
      $('content').replaceChildren(el('div', 'error-state', 'The secure overview could not be refreshed. No data was cached. Try again, or sign out and open the console again.'));
    }
  }
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => show(button.dataset.panel)));
  const refreshButton = el('button', 'quiet-button', 'Refresh');
  refreshButton.type = 'button';
  refreshButton.addEventListener('click', () => {
    refreshButton.disabled = true;
    refresh().finally(() => { refreshButton.disabled = false; });
  });
  $('signout').parentElement.insertBefore(refreshButton, $('signout'));
  $('signout').addEventListener('click', async () => {
    $('signout').disabled = true;
    try { await fetch('/owner/api/session', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' }); } catch {}
    window.location.href = 'https://www.nasrinai.com/';
  });
  show('overview');
  refresh();
})();
