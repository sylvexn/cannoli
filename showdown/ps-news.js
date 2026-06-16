/**
 * Cannoli news overlay for the embedded Pokemon Showdown lobby.
 *
 * The served testclient.html bakes a static "Latest News" entry into the page,
 * and the legacy client only refreshes it when a user types /news (a path that
 * also crashes on our 0-or-1-entry /news.json, since it loops expecting >= 2
 * posts). So on load we fetch /news.json ourselves — nginx proxies it to the
 * Cannoli backend's site announcement — and, when an announcement is set,
 * replace the static welcome with it. No announcement (empty array) or any
 * fetch error leaves the static Cannoli welcome in place as the fallback.
 *
 * Shipped as a standalone file rather than a patch to client-mainmenu.js so it
 * survives upstream client churn (the image re-clones the client on every
 * build) and stays decoupled from the legacy client internals.
 */
(function () {
	function paint(box) {
		fetch('/news.json', { credentials: 'same-origin' })
			.then(function (res) { return res.ok ? res.json() : []; })
			.then(function (data) {
				if (!Array.isArray(data) || !data.length) return; // keep static welcome
				var post = data[0];
				if (!post) return;
				var html = '<div class="newsentry">';
				if (post.title) html += '<h4>' + post.title + '</h4>';
				if (post.summaryHTML) html += '<p>' + post.summaryHTML + '</p>';
				html += '<p>';
				if (post.author) html += '—<strong>' + post.author + '</strong>';
				if (post.date) {
					html += '<small class="date"> on ' + new Date(post.date * 1000).toDateString() + '</small>';
				}
				html += '</p></div>';
				box.innerHTML = html;
			})
			.catch(function () { /* keep static welcome on any error */ });
	}

	// The static news block is server-rendered into testclient.html, so it's
	// usually present at DOMContentLoaded. Retry briefly in case the client
	// re-renders the main menu around us.
	function start(tries) {
		var box = document.querySelector('.news-embed .pm-log');
		if (box) { paint(box); return; }
		if (tries > 0) setTimeout(function () { start(tries - 1); }, 250);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { start(20); });
	} else {
		start(20);
	}
})();
