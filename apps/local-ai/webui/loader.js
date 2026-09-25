// Open WebUI loads /static/loader.js on every page. Mounted from compose.yaml.
//
// Tool call rows: "Tool: web search" instead of "View Result from search_web" with a
// green check. Keyed on the DOM of ToolCallDisplay.svelte (v0.11.4), not on the text,
// so it works in every UI language. The row keeps its own label, just hidden, when it
// asks for approval or input: those need the original wording and buttons.
(() => {
	const NAMES = {
		search_web: 'web search',
		fetch_url: 'read page',
		get_current_timestamp: 'time',
		calculate_timestamp: 'date math'
	};
	const pretty = (name) => NAMES[name] ?? name.replace(/_/g, ' ');

	const apply = () => {
		// The short label (`@md:hidden`) holds the bare tool name.
		for (const short of document.querySelectorAll('span[class~="@md:hidden"]')) {
			const label = short.parentElement;
			const row = label?.parentElement;
			const name = short.textContent.trim();
			if (!row?.closest('[role="button"]') || !/^[\w.-]+$/.test(name)) continue;
			if (!label.querySelector(':scope > span[class~="@md:inline"]')) continue;

			if (name === 'ask_user' || row.querySelector('.tool-call-allow-button')) {
				row.classList.remove('owui-tool');
				continue;
			}

			let own = label.querySelector(':scope > .owui-tool-label');
			if (!own) {
				own = document.createElement('span');
				own.className = 'owui-tool-label';
				label.append(own);
			}
			const text = `Tool: ${pretty(name)}`;
			if (own.textContent !== text) own.textContent = text;
			row.classList.add('owui-tool');
		}
	};

	let queued = false;
	const schedule = () => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			apply();
		});
	};

	new MutationObserver(schedule).observe(document.documentElement, {
		childList: true,
		subtree: true,
		characterData: true
	});
	schedule();
})();
