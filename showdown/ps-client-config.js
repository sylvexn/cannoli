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
