var Config = Config || {};
Config.version = "0.11.2";

Config.defaultserver = {
  id: 'sim-cannoli-live',
  host: 'sim.cannoli.live',
  port: 443,
  httpport: 443,
  registered: true
};

Config.routes = {
  root: 'sim.cannoli.live',
  client: 'sim.cannoli.live',
};

// Login server is the Cannoli backend
Config.loginserver = 'https://cannoli.live/api/ps/';

// PS expects these defined; without them BattleLog.usernameColor crashes on
// the empty-name path (Config.customcolors[''] of undefined) and the topbar
// init throws — which kills the rest of client-main.js init, including the
// SockJS connect that triggers /trn auto-login.
Config.customcolors = {};
Config.bannedHosts = [];
Config.whitelist = [];
