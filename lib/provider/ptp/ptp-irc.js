var config = require('./../../util/config');
var help = require('./../../util/helpers');
var events = require('events');
var util = require('util');

function PTPIRC(logger) {
	events.EventEmitter.call(this);
	this.logger = logger;

	this.client = require('./../../client/irc')(logger, {
		nickname: config.ptp.ircwatch.nickname,
		server: 'irc.passthepopcorn.me',
		port: (config.ptp.ircwatch.useIrcSSL ? 7000 : 6667),
		secure: config.ptp.ircwatch.useIrcSSL,
		iicert: config.ptp.ircwatch.ignoreInvalidIrcSSL,
		channel: '#ptp-announce',
		invitenick: 'Hummingbird',
		invitemsg: 'ENTER '+config.ptp.username+' '+config.ptp.irckey+' #ptp-announce',
		nickpass: config.ptp.ircwatch.nickservPassword,
		masters: config.ptp.ircwatch.masterAuths,
		mastertimeout: config.ptp.ircwatch.masterTimeout,
		debugging: config.app.ircDebugging
	});
	this.regex = /(.+)\s\[(\d+)\].*\s-\s(.*)\s-\s.+php\?id=(\d+)&torrentid=(\d+)\s\//mi;
	this.freeleech = {
		active: false,
		current: 0,
		min: 0,
		max: 0,
		file: 0,
		interval: 0,
		ivwait: false
	};
	this.intervalTimer = null;
}
util.inherits(PTPIRC, events.EventEmitter);

PTPIRC.prototype.connect = function() {
	this.client.connect();
	this.listen();
};

PTPIRC.prototype.listen = function() {
	var self = this;

	this.client.setEvent(function(from, message) {
		self.match(message, false);
	});

	this.client.setMasterEvent(function(from, m) {
		if (typeof m === 'undefined') return;
		if (m.indexOf('!') !== 0) return;

		m = m.replace(/^!/, '');
		self.logger.debug('Got master-command: '+m+' from nick: '+from);

		if (m == 'hello') {
			self.client.say(from, 'Hello '+from);
		}

		else if (m == 'help') {
			self.client.say(from, '!hello - bot will respond if you are authenticated with it');
			self.client.say(from, '!help - displays collection of available commands');
			self.client.say(from, '!test <release> - runs a string through the bot, as if it came from the announce-channel');
			self.client.say(from, '!fl help - displays available Freeleech-commands');
		}

		else if (m.indexOf('test ') === 0) {
			var c = m.replace(/^test /, '');
			self.match(c, true);
		}

		else if (m.indexOf('fl ') === 0) {
			var c = m.replace(/^fl /, '');

			if (c == 'off') {
				if (self.freeleech['active']) {
					self.freeleech['active'] = false;
					self.client.say(from, 'Freeleech-mode turned off');
				}
			}
			else if (c == 'on') {
				if (!self.freeleech['active']) {
					if (self.freeleech['min'] && self.freeleech['max']) {
						self.freeleech['active'] = true;
						self.client.say(from, 'Freeleech-mode turned on');
					}
					else {
						self.client.say(from, 'Freeleech-mode cannot be activated without atleast a min and max download-limit.');
					}
				}
			}
			else if (c == 'reset') {
				self.freeleech['current'] = 0;
				self.client.say(from, 'Freeleech current download-counter has been reset');
			}
			else if (c == 'status') {
				self.__flstatus(from);
			}
			else if (c.indexOf('interval ') === 0) {
				var sc = c.replace(/^interval /, '');
				var s = sc.match(/(\d+)(\w)/i);
				if (s && (s.length > 0)) {
					if ((typeof s[1] !== 'undefined') && (typeof s[2] !== 'undefined')) {

						var interval = help.getSeconds(s[1], s[2]);
						if (interval) {
							self.freeleech['interval'] = interval;
							self.__flstatus(from);
						}
					}
				}
			}
			else if (c.indexOf('size ') === 0) {
				var sc = c.replace(/^size /, '');
				var s = sc.match(/(\d+)(\w)B (\d+)(\w)B (\d+)(\w)B/i);
				if (s && (s.length > 0)) {
					if ((typeof s[1] !== 'undefined') && (typeof s[2] !== 'undefined') &&
						(typeof s[3] !== 'undefined') && (typeof s[4] !== 'undefined') &&
						(typeof s[5] !== 'undefined') && (typeof s[6] !== 'undefined')) {

						var min = help.getBytes(parseInt(s[1]), s[2]);
						var max = help.getBytes(parseInt(s[3]), s[4]);
						var file = help.getBytes(parseInt(s[5]), s[6]);

						if (min && max && file) {
							if ((max-min) > file) {
								self.freeleech['min'] = min;
								self.freeleech['max'] = max;
								self.freeleech['file'] = file;
								self.__flstatus(from);
							}
							else {
								self.client.say(from, 'Woops! Filesize is larger than the difference between min and max - this way nothing would ever be snatched.');
							}
						}
					}
				}
			}
			else {
				self.client.say(from, '!fl on/off - activates or deactivates Freeleech-mode');
				self.client.say(from, '!fl reset - reset the Freeleech download-counter');
				self.client.say(from, '!fl status - shows current Freeleech-progress');
				self.client.say(from, '!fl interval <time> - sets minimum wait time between snatching (supports s, m, h, d)');
				self.client.say(from, '!fl size <min> <max> <file> - sets Freeleech limits (supports KB, MB, GB, TB)');
			}
		}
	});

	self.logger.info('Listening for announces...');
};

PTPIRC.prototype.__flstatus = function(from) {
	this.client.say(from, 'Freeleech settings: Minimum '+help.getSize(this.freeleech['min'])+' -- Maximum '+help.getSize(this.freeleech['max'])+' -- File minimum '+help.getSize(this.freeleech['file']));
	this.client.say(from, 'Freeleech-mode is currently: '+(this.freeleech['active'] ? 'on' : 'off')+' -- Currently snatched '+help.getSize(this.freeleech['current'])+' -- Snatch-interval: '+help.tts(this.freeleech['interval']));
};

PTPIRC.prototype.match = function(message, test) {
	var self = this;
	var m = message.match(this.regex);

	if (m &&
		(typeof m[1] !== 'undefined') &&
		(typeof m[2] !== 'undefined') &&
		(typeof m[3] !== 'undefined') &&
		(typeof m[4] !== 'undefined') &&
		(typeof m[5] !== 'undefined')) {

		var quality = m[3].split(/\s\/\s/);
		var release = {
			'title': m[1],
			'year': m[2],
			'quality': {
				'source': ((typeof quality[1] !== 'undefined') ? quality[1] : ''),
				'resolution': ((typeof quality[3] !== 'undefined') ? quality[3] : ''),
				'container': ((typeof quality[2] !== 'undefined') ? quality[2] : ''),
				'codec': ((typeof quality[0] !== 'undefined') ? quality[0] : '')
			},
			'ptpid': m[4],
			'torrentid': m[5],
			'freeleech': ((typeof quality[4] !== 'undefined') && (quality[4].match(/freeleech/i)))
		};

		self.logger.debug('Match title: '+"\t\t"+release['title']);
		self.logger.debug('Match year: '+"\t\t"+release['year']);
		self.logger.debug('Match format: '+"\t\t"+
				release['quality']['codec']+' / '+
				release['quality']['source']+' / '+
				release['quality']['container']+' / '+
				release['quality']['resolution']+
				(release['freeleech'] ? ' / Freeleech!' : ''));
		self.logger.debug('Match movie ID: '+"\t\t"+release['ptpid']);
		self.logger.debug('Match torrent ID: '+"\t"+release['torrentid']);

		this.matchFreeleech(release, test, function() {
			self.emit('match', release, test);
		});
	}
};

PTPIRC.prototype.matchFreeleech = function(release, test, miss) {
	if (!this.freeleech['active']) return miss();
	if (!release['freeleech']) return miss();

	this.logger.debug(release['title']+' ('+release['year']+') is freeleech, and freeleech-mode is active');

	if (this.freeleech['ivwait']) {
		this.logger.debug('Too close to previous freeleech-snatch, need to wait');
		return miss();
	}

	if (this.freeleech['current'] >= this.freeleech['min']) {
		this.logger.debug('Current freeleech snatched: '+help.getSize(this.freeleech['current'])+' is larger than the minimum-requirement of: '+help.getSize(this.freeleech['min'])+' - stopping freeleech-mode');
		this.freeleech['active'] = false;
		return miss();
	}

	this.logger.debug('Currently have: '+help.getSize(this.freeleech['current'])+' / min: '+help.getSize(this.freeleech['min'])+', max: '+help.getSize(this.freeleech['max'])+' snatched');
	var maxsize = this.freeleech['max']-this.freeleech['current'];

	this.emit('freeleech', release, this.freeleech['file'], maxsize, test);
};

PTPIRC.prototype.freeleechDone = function(size) {
	var self = this;

	self.freeleech['current'] += parseInt(size);
	var min = self.freeleech['min']-self.freeleech['current'];
	var max = self.freeleech['max']-self.freeleech['current'];

	if (min <= 0) {
		self.freeleech['active'] = false;
		return self.logger.debug('Freeleech ended - current size: '+help.getSize(self.freeleech['current'])+' - min: '+help.getSize(self.freeleech['min'])+' - max: '+help.getSize(self.freeleech['max']));
	}

	self.logger.debug('New freeleech current-size: '+help.getSize(self.freeleech['current'])+' - min: '+help.getSize(self.freeleech['min'])+' - max: '+help.getSize(self.freeleech['max'])+' - rem: '+help.getSize(min)+' - '+help.getSize(max));

	if (self.freeleech['interval']) {
		self.logger.debug('Next freeleech allowed in '+self.freeleech['interval']+' seconds');

		self.freeleech['ivwait'] = true;
		self.intervalTimer = setTimeout(function() {
			self.freeleech['ivwait'] = false;
			self.logger.debug('Freeleech interval-timer done, ready for a new freeleech!');
		} (1000*self.freeleech['interval']));
	}
};

module.exports = function(logger) {
	return new PTPIRC(logger);
};
