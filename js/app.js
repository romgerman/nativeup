/*
	---------------------
	-------- APP --------
	---------------------
*/

// https://stackoverflow.com/questions/5379120/get-the-highlighted-selected-text
function getSelectionText() {
    var text = "";
    if (window.getSelection) {
        text = window.getSelection().toString();
    } else if (document.selection && document.selection.type != "Control") {
        text = document.selection.createRange().text;
    }
    return text;
}

// -------------- VUE --------------------

var monthNames = [ "January", "February", "March", "April", "May", "June",
				   "July", "August", "September", "October", "November", "December"
				];

Vue.component('datepicker', {
	template: '#datepicker',
	props: {
		year: {
			type: Number,
			default: new Date().getFullYear()
		},
		month: {
			type: Number,
			default: new Date().getMonth()
		},
		day: {
			type: Number,
			default: new Date().getDate()
		},
		showDays: {
			type: Boolean,
			default: false
		}
	},
	computed: {
		getYears: function() {
			var years = [];

			years.push(new Date().getFullYear());

			//for (var i = 2017; i < 2017 + 5; i++)
				//years.push(i);

			return years;
		},
		getMonths: function() {
			return monthNames;
		},
		getDays: function() {
			return new Date(this.year, this.month, 0).getDate();
		}
	}
});

Vue.component('diff', {
	template: "#diff"
});

Vue.component('item', {
	template: '#item',
	props: {
		def: Object,
		defAddr: String,
		namespace: String,
		open: {
			type: Boolean,
			default: false
		},
		diffOpen: Boolean
	},
	computed: {
		name: function() {
			var n = this.wrapType(this.def.returnType) + " " + (this.open ? this.wrapNamespace(this.namespace + "::") : "") + this.def.name + "(";

			var params = Object.keys(this.def.params);

			for (var i = 0; i < params.length; i++) {
				var item = this.def.params[params[i]];
				n += this.wrapType(item.type) + " ";
				n += this.wrapParam(item.name);

				if (i !== params.length - 1)
					n += ", ";
			}

			return n + ")";
		},
		addr: function() {
			return "0x" + this.defAddr + (this.def.hash ? (" 0x" + this.def.hash) : "");
		},
		linkAddr: function() {
			return '#' + this.namespace + '/' + this.defAddr;
		},
		description: function() {
			var result = this.def.description.replace(/\n/g, '<br>')
									   		 .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
			return this.wrapUrls(result);
		}
	},
	methods: {
		wrapType: function(name) {
			return '<span class="type">' + name + '</span>';
		},
		wrapParam: function(name) {
			return '<span class="param">' + name + '</span>';
		},
		wrapNamespace: function(name) {
			return '<span class="namespace">' + name + '</span>';
		},
		wrapUrls: function(text) {
			return text.replace(/(https?:\/\/[^\s]+\w)|(pastebin.com\/+\w*)/g, (url) => {
				return '<a href="' + (url.startsWith('http') ? url : 'http://' + url) + '" target="_blank">' + url + '</a>';
			});
		},
		onClick: function(e) {
			var text = getSelectionText();

			if (text.length > 0)
			{
				e.preventDefault();
				return;
			}

			this.open = !this.open;
		},
		onGetLinkClick: function(addr) {
			if (this.$root.shiftKey) Router.add(addr);
			else Router.set(addr);
		},
		openDiffs: function() {
			this.diffOpen = !this.diffOpen;
		}
	}
});

var Router = {
	run: function() {
		var hash = window.location.hash;

		if (hash.length <= 1) return null;

		hash = hash.substr(1).split('/').filter(Boolean);

		if (hash[0] === "") return null;

		var output = [];
		var obj = null;

		for (var i = 0; i < hash.length; i++) {
			if (Router.IsNamespace(hash[i])) { // It's a namespace
				if (!obj) {
					obj = { name: hash[i] };
				} else {
					output.push(obj);
					obj = { name: hash[i] };
				}
			} else { // It's a function address
				if (obj) {
					if (obj["list"]) {
						obj.list.push(hash[i]);
					} else {
						obj["list"] = [];
						obj.list.push(hash[i]);
					}
				}
			}
		}

		if (obj) output.push(obj);
		
		return output;
	},
	IsNamespace: function(name) {
		for(var i = 0; i < app.namespaces.length; i++) {
			if (name.toLowerCase() === app.namespaces[i].toLowerCase())
				return true;
		}

		return false;
	},
	set: function(item) {
		var c = item.charAt(item.length - 1);

		if (c === "#") item = item.slice(1);
		
		window.location.hash = item;
	},
	add: function(item) {
		var c = window.location.hash.charAt(window.location.hash.length - 1);
		var a = window.location.hash.split('/').filter(x => x !== '');

		if (!Router.IsNamespace(item)) {
			item = item.slice(1);
			item = item.split('/');

			var itemNamespace = item[0];
			var urlNamespace  = "";

			// Get last namespace from url
			if (a.length !== 0) {
				a[0] = a[0].slice(1);
				for (var i = a.length - 1; i >= 0; i--) {
					if (Router.IsNamespace(a[i])) {
						urlNamespace = a[i];
						break;
					}
				}
			}

			if (urlNamespace.charAt(0) === '#')
				urlNamespace = urlNamespace.slice(1);

			if (itemNamespace.toLowerCase() === urlNamespace.toLowerCase()) {
				window.location.hash += "/" + item[1];
			} else if (!Router.IsNamespace(urlNamespace) && urlNamespace !== "") {
				window.location.hash += "/" + item[1];
			} else {
				window.location.hash += "/" + item[0] + "/" + item[1];
			}
		} else {
			if (c === '/') window.location.hash += item;
			else window.location.hash += "/" + item;
		}
	}
};

var app = new Vue({
	el: '#container',
	data: {
		namespaces: null,
		content: [],
		stack: null,
		shiftKey: false,
		ctrlKey: false,
		query: "",
		theme: false
	},
	created: function() {
		var self = this;

		var theme = Cookies.get('theme');
		if (theme && theme === "true") this.switchTheme();

		this.$http.get('/get/namespaces').then(response => {
			self.namespaces = response.body;
			var route = Router.run();

			if (!route) {
				this.$http.get('/get/latest/namespace/player').then(response => {
					self.content.push({ name: 'PLAYER', body: response.body});
				});
			} else {
				route.forEach(i => {
					if (i["list"]) { // Load list of functions
						var obj = { name: i.name, partial: true, body: {} };
						var index = 0;

						for (var j = 0; j < i.list.length; j++) {
							this.$http.get('/get/latest/function/' + i.list[j]).then(response => {
								obj.body[i.list[index]] = response.body;

								if (index === i.list.length - 1) {
									self.content.push(obj);
								}

								index++;
							});
						}
					} else { // Load full namespace
						this.$http.get('/get/latest/namespace/' + i.name).then(response => {
							self.content.push({ name: i.name, body: response.body });
						});
					}
				});
			}
		});

		window.addEventListener('keydown', (e) => {
			if (e.which === 16) self.shiftKey = true;
			if (e.which === 17) self.ctrlKey  = true;
		});

		window.addEventListener('keyup', (e) => {
			if (e.which === 16) self.shiftKey = false;
			if (e.which === 17) self.ctrlKey  = false;
		});
	},
	methods: {
		isMenuItemActive: function(name) {
			for (var i = 0; i < this.content.length; i++) {
				if (name.toLowerCase() === this.content[i].name.toLowerCase())
					return i;
			}

			return null;
		},
		onMenuItemClick: function(name) {
			var loaded = this.isMenuItemActive(name);
			if (loaded && !this.content[loaded].partial && this.query === "") return;

			if (this.query !== "") {
				this.stack = null;
				this.query = "";
			}

			var self = this;
			var shift = this.shiftKey;

			if (!this.ctrlKey) {
				if (shift) Router.add(name);
				else Router.set(name);
			}

			this.$http.get('/get/latest/namespace/' + name).then(response => {
				if (!shift) self.content = [];
				self.content.push({ name: name, body: response.body });
			});
		},
		switchTheme: function() {
			var style = document.getElementsByTagName("link").item(2);
			style.href = style.href.replace(this.theme ? "dark" : "light",
											this.theme ? "light" : "dark");
			this.theme = !this.theme;

			Cookies.set('theme', this.theme, { expires: 365 });
		}
	},
	watch: {
		'query': function(val, old) {
			if (val === "" || val.length < 2) {
				if (this.stack) {
					this.content = this.stack;
					this.stack = null;
				}
				return;
			}

			var self = this;

			this.$http.get('/search/' + val).then(function(response) {
				if (!response.body) return;
				if (!self.stack) self.stack = self.content;

				self.content = [];
				var ns = Object.keys(response.body);

				for (var i = 0; i < ns.length; i++) {
					self.content.push({ name: ns[i], body: response.body[ns[i]] });
				}
			});
		}
	}
});