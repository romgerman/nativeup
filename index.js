const http = require('http');
const fs = require('fs');
const fsPath = require('path');
const url = require('url');
const Q = require('q');
const front = require('./local/frontend.js');
const differ = require('./local/diff.js');
const native = require('./local/nativedb.js');
const logger = require('winston');

logger.configure({
	transports: [
		new logger.transports.Console({ handleExceptions: true, humanReadableUnhandledException: true }),
		new logger.transports.File({ filename: 'logs/all.log', timestamp: true, json: false }),
	],
	exceptionHandlers: [
		new logger.transports.File({
			filename: 'logs/exceptions.log',
			handleExceptions: true,
			humanReadableUnhandledException: true,
			timestamp: true,
			json: false
		})
	],
	level: 'info'
});

process.on('warning', e => console.warn(e.stack));

const Version = "1.0";

/*
	TODO:
	1. Show info about latest update date
	6. Make left sidebar floating (?)

*/

/* --- HELPERS --- */

const Work = {
	Delay: function (time, callback) {
		var timer = setTimeout(function() {
			callback();
			clearTimeout(timer);
		}, time);
	},
	Repeat: function(delay, repeats, callback) {
		this.delay = delay;
		this.repeats = repeats;
		this._callback = callback;
		this._timer = null;
		this._done = 0;
		this._isRunning = false;

		this.run = function() {
			var self = this;
			this._isRunning = true;

			if (this.repeats) {
				this._timer = setInterval(function() {
					self._callback();

					if (self._done === (self.repeats - 1))
						self.stop();
					else
						self._done++;
				}, this.delay);
			} else {
				this._timer = setInterval(self._callback, this.delay);
			}			

			return this;
		}

		this.stop = function() {
			if (this._timer)
				clearInterval(this._timer);

			this._isRunning = false;

			return this;
		}

		this.changeDelay = function(delay) {
			this.delay = delay;
			this.stop();
			this.run();
		}

		this.reset = function(repeats) {
			this.stop();
			this.repeats = repeats;
		}

		this.isRunning = function() {
			return this._isRunning;
		}
	},
}

function RemoveLast(arr, amount) {
	var newArr = [];
	for(var i = 0; i < arr.length - amount; i++) {
		newArr.push(arr[i]);
	}

	return newArr;
}

function MakeDirIfNotExists(path) {
	if(!fs.existsSync(path))
		fs.mkdirSync(path);
}

function RandomInt(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

/*
	diff item structure:

	property is null if there is no changes

	"E902EF951DCE178F": {
		"name": "GET_PLAYER_RGB_COLOUR",
		"returnType": "void",
		"params": {
			"0": {
				"type": "Player",
				"name": "player"
			},
			"1": {
				"type": "int",
				"name": "r"
			},
			"2": {
				"type": "int",
				"name": "g"
			},
			"3": {
				"type": "int",
				"name": "b"
			}
		},
		"hash": "6EF43BBB",
		"description": {
			"add": [{
				"0": "Returns RGB color of the player (duh)"
			}],
			"rem": []
		}
	},
*/

function BackupItem(path, date, data) {
	this._path = path;
	this._content = data;
	this._date = date;

	this.read = () => {
		var self = this;

		if (this._content) return;

		fs.readFile(this._path, (err, data) => {
			if (err) return logger.error(err);

			self._content = JSON.parse(data.toString());
		});
	}

	this.flush = () => {
		this._content = null;
	}

	this.date = () => this._date;

	this.content = () => this._content;
}

function Database(folder) {
	this.rootFolder = folder;
	this.backups = [];
	this.latest = null;
	this.maxDelayTime = 20 * 60 * 1000; // ms
	this.fetchStartTime = null;

	this.init = function(callback) {
		var self = this;

		MakeDirIfNotExists(this.rootFolder);

		var directories = fs.readdirSync(this.rootFolder);

		if (directories.length <= 0) {
			this.createBackup(() => { if (callback) callback(); });
		} else {
			var allDiffs = [];
			var remaining = 0;
			
			directories.forEach(dir => {
				var dirPath = fsPath.join(self.rootFolder, dir);

				// Check if path is directory
				if (fs.lstatSync(dirPath).isDirectory()) {
					var files = fs.readdirSync(dirPath);
					remaining += files.length;

					// Load each file
					files.forEach(file => {
						var filepath = fsPath.join(dirPath, file);
						fs.readFile(filepath, (e, data) => {
							if (e) return logger.error(e);
							
							allDiffs.push(new BackupItem(filepath,
														 new Date(Number(file.split('.')[0])), JSON.parse(data)));
							remaining--;
						});
					});
				}
			});

			var sortDiffs = () => {
				if (remaining == 0) {
					if (allDiffs.length > 0)
						allDiffs.sort((a, b) => {
							return a.date() - b.date();
						});

					self.backups = allDiffs;

					if (self.backups.length == 1) {
						self.latest = self.backups[0].content();
					} else {
						logger.info('Trying to get latest backup');
						self.getLatestBackup();
						//self.createBackup(); // DEBUG
					}

					if (callback) callback();
					logger.info('Backups has loaded');
				} else {
					Work.Delay(1000, sortDiffs);
				}
			};

			Work.Delay(1000, sortDiffs);
		}

		return this;
	}

	this.createBackup = function(callback) {
		var self = this;

		logger.info("Started creating backup");

		this.fetchEverything().then((data) => {
			var today = new Date();
			var folderPath = fsPath.join(self.rootFolder, today.getMonth() + '-' + today.getFullYear());

			MakeDirIfNotExists(folderPath);

			if (self.backups.length > 0) {
				// Check diffs with previous backup
				var output = {};
				var namespaces = Object.keys(data);

				for (var i = 0; i < namespaces.length; i++) {					
					var namespace = namespaces[i];

					if (namespace === "V") continue;

					var namespaceData = data[namespace];
					var keys = Object.keys(namespaceData);

					for (var j = 0; j < keys.length; j++) {
						var fn = keys[j];

						if (!self.latest[namespace]) continue;

						var diff = differ.GetDiff(self.latest[namespace][fn], namespaceData[fn]);

						if (diff) {
							if (!output[namespace])
								output[namespace] = {};
							output[namespace][fn] = diff;
						}
					}
				}

				data = output;

				self.getLatestBackup(output);
			} else {
				self.latest = data;
			}

			// Save on disk
			var filepath = fsPath.join(folderPath, Date.now().toString() + '.json');
			data["V"] = Version;

			fs.writeFile(filepath, JSON.stringify(data), (e) => {
				if (e) return logger.error(e);

				self.backups.push(new BackupItem(filepath, today, data));
				if (callback) callback();

				logger.info('Backup from ' + today.toString() + ' was saved.\n' +
							'It took ' + new Date(today - self.fetchStartTime).toLocaleTimeString());

				Work.Delay(60000, () => { self.createBackup(); }); // Starting creating next backup
			});
		}, (err) => {
			logger.warn('Couldn\'t create backup');
			if (callback) callback();
		});
	}

	/* Fetch functions */

	this.fetchEverything = function() {
		var self = this;
		
		return Q.Promise((resolve, reject, notify) => {
			self.fetchStartTime = new Date();

			self.fetchAllNamespaces().then((data) => {
				var namespaces = Object.keys(data);
				var index = 0;

				var cb = (result) => {
					data[namespaces[index]] = result;
					
					if (index === namespaces.length - 1)
						return resolve(data);

					index++;
					self.fetchAllFunctionsFromNamespace(data[namespaces[index]]).then(cb);
				};

				self.fetchAllFunctionsFromNamespace(data[namespaces[index]]).then(cb);

			}, (err) => {
				logger.error(err);
				reject(err);
			});
		});
	}

	this.fetchAllFunctionsFromNamespace = function(data) {
		var self = this;
		var remaining = [];
		var result = {};
		
		return Q.Promise((resolve, reject, notify) => {
			var length = data.length;
			var count = 0;

			if (length === 0) resolve(result);
			
			data.forEach((item, i) => {
				Work.Delay(i * RandomInt(1000, 30000), () => {
					console.log("Fetching function: " + item.address[0]);
					
					self.fetchFunction(item.address[0]).then((fndata) => {
						var fn = {
							name: item.name,
							returnType: item.returnType,
							params: item.params,
							hash: fndata.address[1],
							description: { add: {} }
						};

						for (var l = 0; l < fndata.description.length; l++) {
							fn.description.add[l] = fndata.description[l];
						}

						result[item.address[0]] = fn;

						if (count === length - 1) resolve();
						count++;
					}, (err) => {
						remaining.push({ addr: item.address[0], index: i });

						if (count === length - 1) resolve();
						count++;
					});
				});
			});
		}).then(() => {			
			return Q.Promise((resolve, reject, notify) => {
				var length = remaining.length;
				var count = 0;

				if (length === 0) resolve(result);
			
				remaining.forEach((item, i) => {
					Work.Delay(i * RandomInt(5000, 60000), () => {
						console.log("Fetching remaining function: " + item.addr);
						
						self.fetchFunction(item.addr).then((fndata) => {
							var fn = {
								name: item.name,
								returnType: item.returnType,
								params: item.params,
								hash: fndata.address[1],
								description: { add: {} }
							};

							for (var l = 0; l < fndata.description.length; l++) {
								fn.description.add[l] = fndata.description[l];
							}

							result[item.address[0]] = fn;

							if (count === length - 1) resolve(result);
							count++;
						}, (err) => {
							logger.error(err);

							if (count === length - 1) resolve(result);
							count++;
						});
					});
				});
			});
		});
	}

	this.fetchAllNamespaces = function() {
		var self = this;
		
		return Q.Promise((resolve, reject, notify) => {
			var namespaces = Object.keys(native.Endpoints);
			var result = {};
			var index = 0;

			var onFinish = (data) => {				
				if (data)
					result[namespaces[index]] = data;

				console.log("Fetching namespace: " + namespaces[index]);

				if (index === namespaces.length - 1) {
					if (Object.keys(result).length > 0)
						return resolve(result);
					else
						return reject(new Error("Database has failed to get any of namespaces"));
				}

				index++;

				Work.Delay(RandomInt(1000, 30000), () => {
					self.fetchNamespace(native.Endpoints[namespaces[index]]).then((data) => {
						onFinish(data);
					}, (err) => {
						logger.error(err);
						onFinish();
					});
				});
			};
			
			this.fetchNamespace(native.Endpoints[namespaces[index]]).then((data) => {
				onFinish(data);
			}, (err) => {
				logger.error(err);
				onFinish(err);
			});
		});
	}

	this.fetchNamespace = function(endpoint) {
		var self = this;

		return Q.Promise((resolve, reject, notify) => {
			var delay = 1000;

			var errCallback = (err) => {
				if (delay > self.maxDelayTime) {
					logger.error("Nativedb error when fetching " + endpoint);
					logger.error(err);
					return reject(err);
				}

				delay = delay * 2;

				Work.Delay(delay, () => {
					native.GetNamespace(endpoint).then((data) => resolve(data),
														(err) => errCallback(err));
				});
			};
			
			native.GetNamespace(endpoint).then((data) => resolve(data),
												(err) => errCallback(err));
		});
	}

	this.fetchFunction = function(id) {
		var self = this;
		var delay = 1000;

		return Q.Promise((resolve, reject, notify) => {
			var onSuccess = (result) => resolve(result);;

			var onError = (error) => {			
				if (delay > self.maxDelayTime)
					return reject(error);
				
				delay = delay * 2;
				
				Work.Delay(delay, () => native.GetFunctionInfo(id).then(onSuccess, onError));
			};
			
			native.GetFunctionInfo(id).then(onSuccess, onError);
		});
	}

	/* For API */

	this.getLatestBackup = function(newData) {
		if (newData) {
			var namespaces = Object.keys(newData);

			for (var i = 0; i < namespaces.length; i++) {
				var namespace = namespaces[i];
				var namespaceData = newData[namespace];
				var keys = Object.keys(namespaceData);

				for (var j = 0; j < keys.length; j++) {
					var fn = keys[j];
					
					this.latest[namespace][fn] = differ.MergeDiff(this.latest[namespace][fn], namespaceData[fn]);
				}
			}
		} else {
			var data = this.backups[0].content();

			for (var i = 1; i < this.backups.length; i++) {
				var newData = this.backups[i].content();
				var namespaces = Object.keys(newData);

				for (var l = 0; l < namespaces.length; l++) {
					var namespace = namespaces[l];

					if (namespace === "V") continue;

					var namespaceData = newData[namespace];
					var keys = Object.keys(namespaceData);

					for (var j = 0; j < keys.length; j++) {
						var fn = keys[j];
						
						data[namespace][fn] = differ.MergeDiff(data[namespace][fn], namespaceData[fn]);
					}
				}
			}

			this.latest = data;
		}
	}

	this.getLatestFunctionByAddr = function(addr) {
		if (!this.latest || !addr)
			return null;
		
		addr = addr.toUpperCase();
		var namespaces = Object.keys(this.latest);

		for (var i = 0; i < namespaces.length; i++) {
			var namespace = namespaces[i];

			if (namespace === "V" || !this.latest[namespace][addr]) continue;

			var fn = JSON.parse(JSON.stringify(this.latest[namespace][addr]));

			if (fn) {
				var desc = "";
				var keys = Object.keys(fn.description.add);

				for (var j = 0; j < keys.length; j++) {
					desc += fn.description.add[keys[j]];

					if (j !== keys.length - 1)
						desc += '\n';
				}

				fn.description = desc;

				return fn;
			}
		}

		return null;
	}

	this.getLatestNamespaceByName = function(name) {
		if (!this.latest || !name)
			return null;
		
		name = name.toUpperCase();

		if (!this.latest[name])
			return null;

		var ns = JSON.parse(JSON.stringify(this.latest[name]));
		var keys = Object.keys(this.latest[name]);

		for (var i = 0; i < keys.length; i++) {
			var fn = ns[keys[i]];

			if (!fn || !fn.description.add)
				continue;

			var desc = "";
			var dk = Object.keys(fn.description.add);

			for (var j = 0; j < dk.length; j++) {
				desc += fn.description.add[dk[j]];

				if (j !== dk.length - 1)
					desc += '\n';
			}

			fn.description = desc;
		}

		return ns;
	}

	this.getLatestDiff = function() {
		if (!this.latest)
			return null;

		return this.backups[this.backups.length - 1].content();
	}

	this.getFunctionDiffsByDate = function(addr, start, end) {
		if (!this.latest || !addr || !start || !end)
			return null;

		addr = addr.toUpperCase();
		var output = [];

		this.backups.forEach((item) => {
			var backupDate = new Date(item.date());

			if (backupDate >= start && end >= backupDate) {
				var namespaces = Object.keys(item.content());

				for (var i = 0; i < namespaces.length; i++) {
					var namespace = namespaces[i];

					if (namespace === "V") continue;

					if (item.content()[namespace][addr]) {
						var func = JSON.parse(JSON.stringify(item.content()[namespace][addr]));
						func.date = item.date();
						output.push(func);
					}
				}
			}
		});

		if (output.length === 0)
			return null;

		return output;
	}

	this.getNamespaceList = function() {
		if (!this.latest)
			return null;
		
		return Object.keys(this.latest).filter(i => i !== 'V');
	}

	this.findFunctionByNameOrAddress = function(query) {
		if (!this.latest || !query) return null;
		if (query.startsWith('0x')) query = query.substr(2);
		if (query.length < 2) return null;

		var namespaces = Object.keys(this.latest);
		var output = {};

		for (var i = 0; i < namespaces.length; i++) {
			if (namespaces[i] === "V") continue;
			
			var namespace = this.latest[namespaces[i]];
			var keys = Object.keys(namespace);

			for (var j = 0; j < keys.length; j++) {
				var key = keys[j];
				
				if (key.indexOf(query) >= 0 ||
					namespace[key].name.toLowerCase().indexOf(query.toLowerCase()) >= 0)
				{
					if (!output[namespaces[i]])
						output[namespaces[i]] = {};

					var fn = JSON.parse(JSON.stringify(namespace[key]));
					var descKeys = Object.keys(fn.description.add);
					var desc = "";

					for (var l = 0; l < descKeys.length; l++) {
						desc += fn.description.add[descKeys[l]];

						if (l !== descKeys.length - 1)
							desc += "\n";
					}

					fn.description = desc;

					output[namespaces[i]][key] = fn;
				}
			}
		}

		if (Object.keys(output).length === 0) return null;

		return output;
	}
}

var database = new Database('db').init(() => database.createBackup());

/* --- SERVER STUFF --- */

var cache = []; // Cache requested files
var router = new front.Router();

function Send404(response) {
	response.writeHead(404, {'Content-Type': 'application/json'});
	response.end();
}

router.get('/get/info', (req, res) => {
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({}));
});

router.get('/get/namespaces', (req, res) => {
	var ns = database.getNamespaceList();

	if (ns) {
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end(JSON.stringify(ns));
	} else {
		res.writeHead(404, {'Content-Type': 'application/json'});
		res.end();
	}
});

// Return latest namespace function list
router.get('/get/latest/namespace/:name', (request, response, name) => {
	var ns = database.getLatestNamespaceByName(name);

	if (ns) {
		response.writeHead(200, {'Content-Type': 'application/json'});
		response.end(JSON.stringify(ns));
	} else {
		response.writeHead(404, {'Content-Type': 'application/json'});
		response.end();
	}
});

// Return latest function info
router.get('/get/latest/function/:id', (request, response, id) => {
	var fn = database.getLatestFunctionByAddr(id);

	if (fn) {
		response.writeHead(200, {'Content-Type': 'application/json'});
		response.end(JSON.stringify(fn));
	} else {
		response.writeHead(404, {'Content-Type': 'application/json'});
		response.end();
	}	
});

router.get('/get/latest/diff', (request, response) => {
	var diff = database.getLatestDiff();

	if (diff) {
		response.writeHead(200, {'Content-Type': 'application/json'});
		response.end(JSON.stringify(diff));
	} else {
		response.writeHead(404, {'Content-Type': 'application/json'});
		response.end();
	}	
});

// Return function diffs from date to date
router.get('/get/function/:id/diffs/:date+', (request, response, id, date) => {	
	if (date.length < 6 ||
		(isNaN(date[0]) || isNaN(date[1]) || isNaN(date[2])) ||
		(isNaN(date[3]) || isNaN(date[4]) || isNaN(date[5])) ||
		isNaN(new Date(+date[0], +date[1] - 1, +date[2])) ||
		isNaN(new Date(+date[3], +date[4] - 1, +date[5]))) {
		response.writeHead(400, {'Content-Type': 'application/json'});
		response.end('[400] Bad request');
		return;
	}

	var start = new Date(+date[0], +date[1] - 1, +date[2]);
	var end = new Date(+date[3], +date[4] - 1, +date[5]);

	if (start > end) {
		Send404(response);
		return;
	}

	var diff = database.getFunctionDiffsByDate(id, start, end);

	if (diff) {
		response.writeHead(200, {'Content-Type': 'application/json'});
		response.end(JSON.stringify(diff));
	} else {
		Send404(response);
	}
});

router.get('/search/:query', (req, res, query) => {
	var result = database.findFunctionByNameOrAddress(query);

	if (result) {
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end(JSON.stringify(result));
	} else {
		res.writeHead(404, {'Content-Type': 'application/json'});
		res.end();
	}
});

var disableCache = false; // DEBUG
var blacklistDirs = [ "/index.js",
					  "/local",
					  "app.js", // BEBUG
					];

function InBlacklist(value) {
	for (var i = 0; i < blacklistDirs.length; i++) {
		if (value === blacklistDirs[i] ||
			value.startsWith(blacklistDirs[i]) ||
			value.endsWith(blacklistDirs[i]))
			return true;
	}

	return false;
}

router.get(function(request, response) {
	var pathname = url.parse(request.url).pathname;

	if (InBlacklist(pathname)) {
		response.writeHead(404, {'Content-Type': 'text/plain'});
		response.end('[404] Not found');
		logger.info('Requested blacklisted file ' + pathname);
		return;
	}

	if (cache[pathname] && !disableCache) {
		response.writeHead(200, cache[pathname].mime);
		response.end(cache[pathname].data);
	} else {
		if (pathname === '/') {
			fs.readFile('index.html', function (err, data) {
				var item = { data: data, mime: 'text/html' };
				cache['/'] = item;
				cache['index.html'] = item;

				logger.info('Requested file (' + pathname + ') is not in a cache. Caching...');

				response.writeHead(200, { 'Content-Type': item.mime });
				response.end(data);
			});

			return;
		}

		var relative = pathname.substring(1);

		if (fs.existsSync(relative)) {
			fs.readFile(relative, function (err, data) {
				var mt = front.MimeFromPath(pathname);
				var item = { data: data, mime: mt };
				cache[pathname] = item;

				logger.info('Requested file (' + pathname + ') is not in a cache. Caching...');

				response.writeHead(200, { 'Content-Type': mt });
				response.end(data);
			});
		} else {
			logger.info('Requested file (' + pathname + ') does not exist');

			response.writeHead(404, {'Content-Type': 'text/plain'});
			response.end('[404] Not found');
		}
	}
});

http.createServer(function(request, response) {
	router.run(request, response);
}).listen(process.PORT || 5000);

logger.info('Server is running');
