function UrlParameters(host) {
	var data = {};

	this.host = host || false;

	function getUrlStringPart(key, value) {
		return key + "=" + encodeURIComponent(value);
	}

	// Standard key=value parameter
	this.setParameter = function(param, value) {
		data[param] = {
			type: "standard",
			value: value
		};
	};

	this.getUrl = function() {
		var parameterKeys = Object.keys(data);
		var urlParameters = [];
		for (var i = 0; i < parameterKeys.length; i++) {
			if (!data.hasOwnProperty(parameterKeys[i])) {
				continue;
			}
			switch (data[parameterKeys[i]].type) {
				case "array":
					for (var j = 0; j < data[parameterKeys[i]].value.length; j++) {
						if (!data[parameterKeys[i]].value.hasOwnProperty(j)) {
							continue;
						}
						urlParameters.push(getUrlStringPart(parameterKeys[i] + "[]", data[parameterKeys[i]].value[j]));
					}
					break;
				case "standard":
				default:
					urlParameters.push(getUrlStringPart(parameterKeys[i], data[parameterKeys[i]].value));
			}
		}
		return this.host + "?" + urlParameters.join("&");
	};
}

var ConverseUtil = {
	sid: null,
	getCookie: function(name) {
		var nameEq = name + "=";
		var ca = document.cookie.split(";");
		for (var i = 0; i < ca.length; i++) {
			var c = ca[i];
			while (c.charAt(0) === " ") c = c.substring(1, c.length);
			if (c.indexOf(nameEq) === 0) return c.substring(nameEq.length, c.length);
		}
		return null;
	},

	isValidUrl: function(msg) {
		return msg.match(/^(?:http(s)?:\/\/)?[\w.-]+(?:\.[\w\.-]+)+[\w\-\._~:/?#[\%\]@!\$&'\(\)\*\+,;=.]+$/ig);
	},

	putCookie: function(name, value) {
		document.cookie = name + "=" + value;
	},

	uuidV4: function() {
		let cryptoAPI;

		if (window.crypto && window.crypto.getRandomValues) {
			cryptoAPI = window.crypto;
		} else if (window.msCrypto && window.msCrypto.getRandomValues) {
			cryptoAPI = window.msCrypto;
		} else {
			throw "Unsupported browser";
		}

		return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, function(c) {
			return (c ^ cryptoAPI.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
		});
	},

	sessionInLocalStorage: function(name, value) {
		if (!name) {
			name = "cSession";
		}
		try {
			if (!window.localStorage) {
				return undefined;
			}

			if (value) {
				window.localStorage[name] = value;
			}

			if (!value) {
				return window.localStorage[name];
			}
		} catch (e) {
			return undefined;
		}
	},

	getSession: function(botId) {
		this.sid = this.sessionInLocalStorage(botId) || (this.uuidV4() + (botId ? ":" + botId : ""));

		return this.sid;
	}
};

function ConverseWebClient(options) {
	this.host = options.host;
	this.converseHost = options.converseHost;
	this.botId = options.botId;
	this.user = options.user;
	this.tenant = options.tenant;
	this.startPhrase = options.start || options.startPhrase || null;
	this.baseContainer = options.container;
	this.showCloseButton = typeof options.showCloseButton === "boolean" ? options.showCloseButton : true;
	this.showSettingsButton = typeof options.showSettingsButton === "boolean" ? options.showSettingsButton : true;
	this.sendCallback = options.sendCallback;
	this.receiveCallback = options.receiveCallback;
	this.hideCallback = options.hideCallback;
	this.title = options.title || "Chat";
	this.FADE_TIME = options.FADE_TIME || 150; // ms
	this.REDATE_TIME = options.REDATE_TIME || 10; // minutes
	this.isTypingDelay = options.isTypingDelay || 2000; // milliseconds
	this.hideIcon = options.hideIcon || "fa-minus";
	this.hideSendButton = options.hideSendButton === true;
	this.placeholder = options.placeholder || "Type a message...";
	this.disabledPlaceholder = options.disabledPlaceholder || "Choose an option above...";
	this.sendButtonTitle = options.sendButtonTitle || "Send";
	this.serverUserImage = options.serverUserImage || "pb-circle-mark.png";
	this.reConnectDelay = options.reConnectDelay || 2000;
	this.disconnectedText = options.disconnectedText || "Disconnected - trying to reconnect";
	this.showBrowseButton = typeof options.showBrowseButton === "boolean" ? options.showBrowseButton : true;
	this.showToolbar = typeof options.showToolbar === "boolean" ? options.showToolbar : false;
	this.downloadText = options.downloadText || "download";
	this.downloadErrorText = options.downloadErrorText || null;
	this.clientUserImage = options.clientUserImage || "";
	this.windowOpen = options.windowOpen || window.open;
	this.$baseTemplate = "";
	this.lastTimestamp = 0;
	this.lastDirection = "none";
	this.lastContainer = null;
	this.tryReconnect = false;
	this.allowHTML = typeof options.allowHTML === "boolean" ? options.allowHTML : false;
	this.incomingMessages = {};
	this.botOpened = false;
	this.isTyping = false;
	this.openRetries = options.openRetries || 5;
	this.openCount = 0;
}

ConverseWebClient.prototype.setReceiveCallback = function(callback) {
	this.receiveCallback = callback;
};

ConverseWebClient.prototype.setSendCallback = function(callback) {
	this.sendCallback = callback;
};

ConverseWebClient.prototype.initSocket = function() {
	let client = this,
		sid = ConverseUtil.getSession(this.botId);

	var events = {
		"text": client.onText.bind(client),
		"buttons": client.onButtons.bind(client),
		"card": client.onCard.bind(client),
		"buttonCard": client.onCardButton.bind(client),
		"quick_replies": client.onQuickReply.bind(client),
		"type_on":  client.onTypeOn.bind(client),
		"type_off": client.onTypeOff.bind(client),
		"account_link_redirect": client.onAccountLinkRedirect.bind(client),
		"disconnect": client.onDisconnect.bind(client),
		"attachment": client.onAttachment.bind(client),
		"attached-text": client.onAttachedText.bind(client),
		"attached-error": client.onAttachedErrorText.bind(client),
		"connect": client.onConnect.bind(client)
	};

	ConverseUtil.sessionInLocalStorage(this.botId, sid);

	var protocol = window.location.protocol.indexOf("https") > -1 ? "wss" : "ws" ;
	var url = new URL(client.host);

	client.socket = new WebSocket(protocol + "://" + url.host + "/channel/send");

	client.socket.onmessage = function(messageEvent) {
		try {
			var msg = JSON.parse(messageEvent.data);
		} catch(e) {
			return;
		}

		if (!msg.type || !events[msg.type]) {
			console.error("Unrecognized event");
			return;
		}

		events[msg.type](msg.message);
	};

	client._enableChatWindow();


	/*
	this.socket.on("bot_opened", function() {
		if (client.openBotTimer) {
			clearTimeout(client.openBotTimer);
		}
		client.openCount = 0;
		client.botOpened = true;
	});
  */

	return client.socket;
};

ConverseWebClient.init = function(opts, callback) {
	var client = new ConverseWebClient(opts);

	$.ajax({
		url: client.host + "/chat/init",
		method: "POST",
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(client.user),
		dataType: "json",
		success: function(res) {
			console.log("are we here at chat/init success??");
			client.user.session = res.session;
			client.user.chatid = res.id;

			client.initSocket();

			client._buildInterface();
			client.renderMain.call(client, typeof callback === "function" ? callback.bind(client, client) : null, res.messages);

		}
	});

	// client._disableChatWindow();

	return client;
};

ConverseWebClient.prototype._buildInterface = function() {
	var client = this;

	client.$baseTemplate = $("<div class=\"pb-chat-popup-box\"></div>");

	var $popHead = $("<div class=\"pb-chat-popup-head\"></div>");

	if (this.allowHTML) {
		$popHead.append($("<div class=\"pb-webchat-title\"></div>").html(client.title));
	} else {
		$popHead.append($("<div class=\"pb-webchat-title\"></div>").text(client.title));
	}

	var $headRight = $("<div class=\"pb-chat-popup-head-right pull-right\"></div>");

	var $btnGroup = $("<div class=\"btn-group\"></div>");
	$btnGroup.append($("<span id=\"connection\" title=\"" + client.disconnectedText + "\" class=\"pb-chat-header-connected\"><i id=\"connectedIcon\" class=\"fas fa-bolt pb-chat-connected-indicator\"></i> </span>"));

	if (client.showSettingsButton) {
		$btnGroup.append($("<button id=\"pb-dropdown\" class=\"pb-dropdown pb-chat-header-button\" type=\"button\" data-toggle=\"dropdown\" aria-expanded=\"false\"><a href=\"#\"><i class=\"fas fa-cog\"></i></a></button>"));
	}

	var $lst = $("<div id=\"menu\" class=\"pb-dropdown-content\"></div>");
	var $clearChat = $("<li><a href=\"#\">Clear Chat</a></li>");

	$clearChat.click(function() {
		client.clearChat();
	});

	$lst.append($clearChat);

	if (client.showCloseButton) {
		$btnGroup.append($("<button data-widget=\"remove\" id=\"closeChat\" class=\"pb-chat-header-button pull-right\" type=\"button\"><a href=\"#\"><i class=\"fas " + client.hideIcon + "\"></i></a></button>"));
	}

	$headRight.append($btnGroup);
	$headRight.append($lst);
	$popHead.append($headRight);

	client.$baseTemplate.append($popHead);

	var $messageSection = $("<div id=\"messagesWrapper\" class=\"pb-chat-popup-messages" + (this.showToolbar ? " pb-adjust-message-wrapper" : "") + "\"></div>")
		.append($("<div id=\"messages\" class=\"pb-chat-direct-chat-messages\"></div>"));

	client.$baseTemplate.append($messageSection);

	var $footer = $("<div class=\"pb-chat-popup-messages-footer\"></div>")
		.append($("<div id=\"typing\" class=\"pb-chat-typing-indicator\"><span></span><span></span><span></span></div>"));

	var $sendField = $("<textarea />")
		.attr("id", "status_message")
		.attr("placeholder", client.placeholder)
		.attr("name", "message")
		.addClass(client.hideSendButton ? "fullwidth" : "no-fullwidth");

	var $sendButton = $("<button />").attr("id", "send")
		.addClass("pb-chat-send-button")
		.attr("type", "button")
		// .attr("disabled", true)
		.data("widget", "send")
		.html(client.sendButtonTitle);

	var $messageBox = $("<div />").addClass("pb-chat-popup-messages-message-box")
		.append($sendField);

	if (!client.hideSendButton) {
		$messageBox.append($sendButton);
	}

	$footer.append($messageBox);

	if (this.showToolbar) {

		var $toolbar = $("<div id=\"pb-chat-toolbar\" class=\"pb-chat-toolbar\"></div>");
		var id = this.baseContainer.replace("#", "");
		if (this.showBrowseButton) {
			$toolbar.append("<label for=\"" + id + "-pb-file-upload\" class=\"pb-btn pb-btn-link pb-chat-toolbar-btn\">\n" +
				"    <i class=\"fas fa-paperclip\"></i>" +
				"</label><input id=\"" + id + "-pb-file-upload\" type=\"file\" class=\"pb-file-upload\" name=\"fileToUpload\" multiple>");

			$footer.append("<div id=\"" + id + "-pb-file-uploader\"></div>");
			$toolbar.append("<div id=\"" + id + "-pb-file-name\" class=\"pb-chat-file-upload-text\"></div>");
		}
		$footer.append($toolbar);
	}

	client.$baseTemplate.append($footer);
};

ConverseWebClient.prototype._enableChatWindow = function() {
	if (!this.hideSendButton) {
		$(this.baseContainer).find("#send").prop("disabled", false);
		$(this.baseContainer).find(".pb-chat-send-button").removeClass("disabled");
	}

	$(this.baseContainer).find("#messagesWrapper").prop("disabled", false);
	$(this.baseContainer).find("#status_message").prop("disabled", false);
	$(this.baseContainer).find(".pb-btn").prop("disabled", false);
	$(this.baseContainer).find("span").css("pointer-events", "auto");
	$(this.baseContainer).find("#connectedIcon").removeClass("pb-chat-disconnected");
	$(this.baseContainer).find("#connection").removeClass("pb-chat-disconnected");
};

ConverseWebClient.prototype._disableChatWindow = function() {
	$(this.baseContainer).find("#connectedIcon").addClass("pb-chat-disconnected");
	$(this.baseContainer).find("#connection").addClass("pb-chat-disconnected");
	$(this.baseContainer).find("#send").prop("disabled", true);
	$(this.baseContainer).find("#status_message").prop("disabled", true);
	$(this.baseContainer).find("#messagesWrapper").prop("disabled", true);
	$(this.baseContainer).find("span").css("pointer-events", "none");
	$(this.baseContainer).find(".pb-btn").prop("disabled", true);
	$(this.baseContainer).find(".pb-chat-send-button").addClass("disabled");
};

ConverseWebClient.prototype.onConnect = function() {
	var client = this;

	if (client.tryReconnect) {
		client.socket.emit("reestablised", { tenantId: client.tenant, botid: client.bot, user: client.user });
	}

	client.tryReconnect = false;
	client._enableChatWindow();

	if (client.retryIntrval) {
		clearInterval(client.retryIntrval);
	}
};

ConverseWebClient.prototype.onReconnect = function() {
	if (this.socket.disconnected) {
		this.tryReconnect = true;
		this.socket.connect();
		this.socket.open();
	}
};

ConverseWebClient.prototype.onAttachment = function(message) {
	message.data.direction = message.data.direction === "inbound" ? "outbound" : "inbound";
	this.addDownloadMessage(message.data);
	if (this.receiveCallback) {
		this.receiveCallback(message);
	}
};

ConverseWebClient.prototype.onAttachedText = function(message) {
	message.direction = message.direction === "outbound" ? "inbound" : "outbound";
	if (message.hasOwnProperty("originalName")) {
		return this.addDownloadMessage(message);
	}
	this.addChatMessage({
		direction: message.direction,
		message: message.data.originalName
	});
};

ConverseWebClient.prototype.onAttachedErrorText = function(message) {
	this.addChatMessage({
		direction: "error",
		message: (this.downloadErrorText || message.msg).replace("${name}", message.name)
	});
};

ConverseWebClient.prototype.onText = function(message) {
	this.text(message.message);
	if (this.receiveCallback) {
		this.receiveCallback(message);
	}
};

ConverseWebClient.prototype.onButtons = function(data) {
	this.addButtonMessage(data.data);
	if (data.disableTextInput) {
		this.disableTextArea();
	}
	if (this.receiveCallback) {
		this.receiveCallback(data);
	}
};

ConverseWebClient.prototype.onCard = function(data) {
	this.addCardMessage(data.data);
	if (this.receiveCallback) {
		this.receiveCallback(data);
	}
};

ConverseWebClient.prototype.onCardButton = function(messageEvent) {
	var data = [messageEvent.data];
	this.addCardMessage(data);
	if (data.disableTextInput) {
		this.disableTextArea();
	}
	if (this.receiveCallback) {
		this.receiveCallback(data);
	}
};

ConverseWebClient.prototype.clearChat = function() {
	$(this.baseContainer).find("#messages").empty();
	$(this.baseContainer).find(".pb-dropdown-content").toggleClass("show");
	this.lastTimestamp = 0;
	this.lastDirection = null;
	this.sendPostBackSilent("#silentcancel#");
};

ConverseWebClient.prototype.onQuickReply = function(messageEvent) {
	var data = messageEvent.data;

	this.addQuickReplyMessage(data);
	if (data.disableTextInput) {
		this.disableTextArea();
	}
	if (this.receiveCallback) {
		this.receiveCallback(data);
	}
};

ConverseWebClient.prototype.onDisconnect = function() {
	var client = this;
	client.socket.close();
	// client._disableChatWindow();

	client.retryIntrval = setInterval(function() {
		client.onReconnect();
	}, client.reConnectDelay);
};

ConverseWebClient.prototype.cleanInput = function(input) {
	return $("<div/>").text(input).text();
};

ConverseWebClient.prototype.openBot = function(tenant, bot, user) {
	let client = this;
	// client._disableChatWindow();
	if (!client.socket) {
		throw "Socket is not connected. Did you remember to call ConverseWebChat.init?";
	}

	client.tenant = client.tenant || tenant;
	client.botId = client.botId || bot;
	client.user = client.user || user || {};

	client.openCount++;
	if (client.openCount < client.openRetries) {
		client.openBotTimer = setTimeout(function() {
			client.openBot(tenant, bot, user);
		}, 2000);

		this.socket.emit("openBot", { tenantId: tenant, botid: bot, user: user });
	}
};

ConverseWebClient.prototype.text = function(message) {
	this.addChatMessage({
		direction: "inbound",
		message: message.text.type === "card" ? message.text.text : message.text
	});
};

ConverseWebClient.prototype.onTypeOn = function() {
	$(this.baseContainer).find("#typing").addClass("pb-chat-typing-on");
};

ConverseWebClient.prototype.onTypeOff = function() {
	$(this.baseContainer).find("#typing").removeClass("pb-chat-typing-on");
};

ConverseWebClient.prototype.onAccountLinkRedirect = function(packet) {
	this.windowOpen.call(window, packet, "_blank");
};

ConverseWebClient.prototype.messageSend = function() {
	var msg = this.cleanInput($(this.baseContainer).find("#status_message").val());
	var files = [];
	var fileTimeoutValue = 0;
	if ($(this.baseContainer).find(this.baseContainer + "-pb-file-upload").length > 0) {
		files = $(this.baseContainer).find(this.baseContainer + "-pb-file-upload")[0].files;
	}

	if (msg) {
		this.sendMessage(msg);
		$(this.baseContainer).find("#status_message").val("");
		fileTimeoutValue = 1000;
	}

	if (files && files.length) {
		var _this = this;
		setTimeout(function() {
			_this.sendFiles(files);
			$(_this.baseContainer).find(_this.baseContainer + "-pb-file-upload").val("");
			$(_this.baseContainer).find(_this.baseContainer + "-pb-file-name").text("");
		}, fileTimeoutValue);
	}
};
ConverseWebClient.prototype.userIsTyping = function() {
	if (!this.isTyping) {
		this._callSend({}, "typing_on")
	}
	this.isTyping = true;
};
ConverseWebClient.prototype.userStopTyping = function() {
	if (this.isTyping) {
		this._callSend({}, "typing_off")
	}
	if (this.typingTimeout) {
		clearTimeout(this.typingTimeout);
	}
	this.isTyping = false;
};
ConverseWebClient.prototype.renderMain = function(callback, history) {
	console.log("args", arguments);
	var me = this;
	$(me.baseContainer).append(me.$baseTemplate);
	$(me.baseContainer).find("#closeChat").click(function () {
		me.hide();
	});
	$(me.baseContainer).find("#status_message").keydown(function (event) {
		if (event.which === 13) {
			me.messageSend();
			event.preventDefault();
		}
		if (event.which === 8 || event.which === 32 ||
			(event.which > 44 && event.which < 112) || event.which > 123) { // alt, ctrl, esc, F1, F2, ...
			me.userIsTyping();
		}
	});
	$(me.baseContainer).find("#status_message").keyup(function (event) {
		if (me.typingTimeout) {
			clearTimeout(me.typingTimeout);
		}
		me.typingTimeout = setTimeout(function () {
			me.userStopTyping();
		}, me.isTypingDelay);
	});

	$(me.baseContainer).find("#send").click(function () {
		me.messageSend();
		$(me.baseContainer).find("#status_message").focus();
	});
	if (typeof callback === "function") {
		callback();
	}
	$(me.baseContainer).find("#pb-dropdown").click(function() {
		$(me.baseContainer).find(".pb-dropdown-content").toggleClass("show");
	});

	$(me.baseContainer).find("#pb-dropdown").onclick = function(event) {
		if (event.target &&
			event.target.offsetParent &&
			event.target.id !== "pb-dropdown" &&
			event.target.offsetParent.id !== "pb-dropdown") {

			var dropdowns = $(me.baseContainer).find(".pb-dropdown-content");
			var i;
			for (i = 0; i < dropdowns.length; i++) {
				var openDropdown = dropdowns[i];
				if (openDropdown.classList.contains("show")) {
					openDropdown.classList.remove("show");
				}
			}
		}
	};
	if (this.showToolbar) {
		$(me.baseContainer).find(this.baseContainer + "-pb-file-upload").change(function() {
			var files = $(me.baseContainer).find(me.baseContainer + "-pb-file-upload")[0].files;
			var fileArray = [];
			var fileString = "";

			Object.keys(files).forEach(function(key) {
				fileArray.push($(me.baseContainer).find(me.baseContainer + "-pb-file-upload")[0].files[key].name);
			});
			if (fileArray.length > 0) {
				fileString = fileArray.join(", ");
			}

			$(me.baseContainer).find(me.baseContainer + "-pb-file-name").text(fileString);
			$(me.baseContainer).find(me.baseContainer + "-pb-file-name").attr("title", fileString);
		});

		$(me.baseContainer).find(me.baseContainer + "-pb-file-upload").on("click", function() {
			$(me.baseContainer).find(me.baseContainer + "-pb-file-upload").val("");
			$(me.baseContainer).find(me.baseContainer + "-pb-file-name").text("");
		});
	}

		let events = [
			"text",
			"postback",
			"buttons",
			"card",
			"buttonCard",
			"quick_replies",
			"account_link_redirect",
			"disconnect",
			"attachment",
			"attached-text",
			"attached-error",
			"connect",
			];

		if (!history.length) {
			console.log("send postback?");
			setTimeout(() => { me.sendPostBackSilent("start"); }, 1000);
		} else {
			for (let message of history) {
				if (!events.includes(message.data.type)) {
					continue;
				}
				switch (message.data.type) {
					case "text":
					case "postback":
						me.addChatMessage({
							direction: message.direction,
							message: message.data.message.text.type === "card" ? message.data.message.text.text : message.data.message.text
						});
						break;
					case "buttons":
						me.addButtonMessage({
							direction: message.direction,
							text: message.data.data.text,
							buttons: message.data.data.buttons
						});
						break;
					case "card":
						me.addCardMessage(message.data.data);
						break;
					case "buttonCard":
						me.onCardButton({
							direction: message.direction,
							data: message.data.data
						});
						break;
					case "quick_replies":
						me.addQuickReplyMessage({
							direction: message.direction,
							text: message.data.data.text,
							quick_replies: message.data.data.quick_replies
						});
						break;
					case "attachment":
						me.onAttachment({
							direction: message.direction === "inbound" ? "outbound" : "inbound",
							data: message.data.data
						});
						break;
					case "attached-text":
						me.onAttachedText({
							direction: message.direction,
							data: message.data.data
						});
						break;
					default:
						break;
				}
			}
		}


};

ConverseWebClient.prototype.sendPostBack = function(payload, title, message) {
	if (payload || title || message) {
		this.sendPostBackSilent(payload, title, message);
		this.addChatMessage({
			direction: "outbound",
			message: payload || title || message
		});
	}
};

ConverseWebClient.prototype.sendPostBackSilent = function(payload, title, message) {
	var self = this;

	if (!payload && !title) {
		return;
	}

	var msg = {
		text: payload || title,
		incomingMessage: message
	};

	self._callSend(msg, "postback");

	if (self.sendCallback) {
		self.sendCallback(msg.text);
	}
};

ConverseWebClient.prototype.sendMessage = function(text) {
	if (!text) {
		this.userStopTyping();
		return;
	}

	let msg = {
		text: text
	};

	if (this.sendCallback && (!this.sendCallback(text))) {
		this.userStopTyping();
		return;
	}

	this._callSend(msg, "text");

	this.addChatMessage({
		direction: "outbound",
		message: text
	});

	this.userStopTyping();
};

ConverseWebClient.prototype.sendFiles = function(files) {
	var self = this;
	var outboundFiles = [];

	if (files) {
		var fileObject = $(this.baseContainer).find(this.baseContainer + "-pb-file-upload");

		Object.keys(files).forEach(function(key) {
			var p = new Promise(function(resolve, reject) {
				var file = fileObject[0].files[key];
				var fileReader = new FileReader();

				fileReader.readAsBinaryString(file);

				fileReader.onload = function(e) {
					resolve({
						file: e.currentTarget.result,
						name: file.name,
						size: file.size,
						type: file.type
					});
				};
				
				fileReader.onerror = function(e) {
					reject(e)
				};
			});
			
			outboundFiles.push(p);
		});


		Promise.all(outboundFiles).then(function(r) {
			self._callSend(outboundFiles, "attachments");
		});
	}
};

ConverseWebClient.prototype._callSend = function(msg, type) {
	let payload = JSON.stringify({
		type: type,
		timestamp: Date.now(),
		message: msg,
		sender: this.user,
		recipient: {
			"bot": this.botId,
			"tenant": this.tenant
		}
	});

	this.socket.send(payload, { binary: type === "attachments" });
};

ConverseWebClient.prototype.show = function() {
	$(this.baseContainer).addClass("pb-chat-popup-box-on");
};

ConverseWebClient.prototype.hide = function() {
	$(this.baseContainer).removeClass("pb-chat-popup-box-on");
	if (this.hideCallback) {
		this.hideCallback();
	}
};

ConverseWebClient.prototype.setWrapperItems = function(data) {
	var reset = false;
	if (this.lastTimestamp < ((new Date()).getTime() - (this.REDATE_TIME * (1000 * 60)))) {
		this.lastTimestamp = (new Date()).getTime();
		rest = true;
		$(this.baseContainer).find("#messages").append($("<div class=\"pb-chat-box-single-line\"><abbr class=\"timestamp\">" + this.getTimeStamp() + "</abbr></div>"));
	}

	if (!this.lastContainer || this.lastDirection !== data.direction || reset) {
		var $msgWrapper = $("<div class=\"pb-chat-direct-chat-msg doted-border pb-" + data.direction + "-container\"></div>");
		var $items = $("<div class=\"pb-" + data.direction + "-items\"></div");
		if (data.direction === "inbound") {
			$msgWrapper.append($("<img alt=\"PitneyBowes\" src=\"" + this.serverUserImage + "\" class=\"pb-chat-direct-chat-img\">"));
		}

		$msgWrapper.append($items);

		if (data.direction === "outbound" && !!this.clientUserImage) {
			$msgWrapper.append($("<img alt=\"PitneyBowes\" src=\"" + this.clientUserImage + "\" class=\"pb-chat-direct-chat-img\">"));
		}
		$(this.baseContainer).find("#messages").append($msgWrapper);
		this.lastContainer = $msgWrapper;
		this.lastContainerItems = $items;
		this.lastDirection = data.direction;
	}
};

ConverseWebClient.prototype.buttonClick = function(e, button) {
	var $button = $(e.target);
	var ts = $button.parents("div[data-timestamp]").data("timestamp");
	var message = this.incomingMessages[ts];
	var url = "";
	var urlParams = new UrlParameters(this.host + "/proxy/redirect");

	urlParams.setParameter("target", button.url);
	urlParams.setParameter("button", button.title);
	urlParams.setParameter("sessionid", ConverseUtil.getSession());
	if (message && message.hasOwnProperty("text")) {
		urlParams.setParameter("message", message.text);
	}

	switch (button.type) {
		case "account_unlink":
			this._callSend({}, "account_unlink");
			break;
		case "account_link":
			this.windowOpen.call(window, button.url, "account_link");
			break;
		case "web_url":
			this.windowOpen.call(window, urlParams.getUrl(), "_blank");
			break;
		case "phone_number":
			urlParams.setParameter("target", "tel:+" + button.payload);
			this.windowOpen.call(window, urlParams.getUrl(), "_self");
			break;
		case "postback":
		default:
			this.sendPostBack(button.payload, $("<div>" + button.title + "</div>").text(), message);
			break;
	}

	this.enableTextArea();
};

ConverseWebClient.prototype.addQuickReplyMessage = function(data) {
	data.direction = "inbound";
	var me = this;
	me.setWrapperItems(data);

	var $buttonContainer = $("<div />", {
		"class": "pb-chat-direct-chat-text-inbound"
	});
	if (this.allowHTML) {
		$buttonContainer.text(data.text);
	} else {
		$buttonContainer.html(data.text);
	}

	var $messageButtons = $("<div />", {
		"class": "pb-chat-quick-reply-container"
	});


	$.each(data.quick_replies, function(index, button) {
		var $button = $("<span />", {
			"class": "pb-chat-badge-brand-info quick-reply"
		});

		if (this.allowHTML) {
			$button.html(button.title);
		} else {
			$button.html(button.title);
		}

		$button.on("click", function(e) {
			me.buttonClick(e, button);
			$messageButtons.hide();
		});

		if (button.image_url) {
			$button.append("<img class=\"quick-reply-img\" src=\"" + button.image_url + "\">");
		}
		$messageButtons.append($button);
	});

	$buttonContainer.append($messageButtons);
	me.addMessageElement($buttonContainer, data);
};

ConverseWebClient.prototype.addCardMessage = function(data, options) {
	var me = this;
	data.direction = "inbound";
	me.setWrapperItems(data);
	var timestamp = new Date(),
		cardContainerId = "cardContainer" + timestamp.getHours() + "" + timestamp.getMinutes() + "" + timestamp.getSeconds() + "" + timestamp.getMilliseconds();

	var cardsWrapper = $("<div />", { "class": "pb-cards-wrapper" }),
		cardContainer = $("<div />", { "class": "pb-chat-card-container", id: cardContainerId });

	$.each(data, function(index, card) {
		var cardEl = $("<div />", { "class": "pb-chat-card" });

		if (card.image_url) {
			if (card.image_url.indexOf("www.youtube.com/embed") > -1) {
				cardEl.append("<iframe class=\"pb-cards-iframe\" frameborder=\"0\" target=\"_parent\" src=\"" + card.image_url + "\"></iframe>");
			} else {
				cardEl.append($("<img />", { "class": "pb-chat-image", src: card.image_url }));
			}
		}
		if (this.allowHTML) {
			cardEl.append($("<div />", { "class": "pb-chat-title", html: card.title }));
		} else {
			cardEl.append($("<div />", { "class": "pb-chat-title", text: card.title }));
		}

		if (card.subtitle) {
			if (this.allowHTML) {
				cardEl.append($("<div />", { "class": "pb-chat-subtitle", html: card.subtitle}));
			} else {
				cardEl.append($("<div />", { "class": "pb-chat-subtitle", text: card.subtitle}));
			}
		}

		if (card.item_url) {
			cardEl.append($("<a>", { "class": "pb-chat-url", text: card.item_url, href: card.item_url, target: "_blank" }));
		}

		var $buttonContainer = $("<div />", { "class": "pb-chat-button-container" });

		$.each(card.buttons, function(index, button) {
			var $button = $("<button type='button' class='pb-btn pb-btn-default pb-chat-btn-live-preview'>" + button.title + "</button>");

			$button.on("click", function(e) {
				me.buttonClick(e, button);
			});

			$buttonContainer.append($button);
		});

		cardEl.append($buttonContainer);
		cardContainer.append(cardEl);
	});

	cardsWrapper.append(cardContainer);

	if (data.length > 1) {
		cardsWrapper.append("<div class=\"card-nav-btns-custom\">" +
			"<div class=\"card-nav-item\">" +
			"<button class=\"slick-prev-custom\" type=\"button\"></button>" +
			"</div>" +
			"<div class=\"dots-custom card-nav-item\"></div>" +
			"<div class=\"card-nav-item\">" +
			"<button class=\"slick-next-custom\" type=\"button\"></button>" +
			"</div>" +
			"</div>");
	}

	this.addMessageElement(cardsWrapper, data);

	cardContainer.slick({
		variableWidth: false,
		prevArrow: cardsWrapper.find(".slick-prev-custom"),
		nextArrow: cardsWrapper.find(".slick-next-custom"),
		dots: false,
		appendDots: cardsWrapper.find(".card-nav-btns-custom .dots-custom")
	});
};

ConverseWebClient.prototype.addButtonMessage = function(data, options) {
	var me = this;
	var ts = Date.now();
	this.incomingMessages[ts] = data;
	data.__id = ts;
	data.direction = "inbound";
	this.setWrapperItems(data);
	var $buttonContainer = $("<div data-timestamp=\"" + ts + "\" class=\"pb-chat-direct-chat-text-inbound\"></div>");
	var $messageText = $("<div class=\"pb-chat-button-text\"></div>");
	if (this.allowHTML) {
		$messageText.html(data.text);
	} else {
		$messageText.text(data.text);
	}

	var $messageButtons = $("<div class=\"pb-chat-button-container\"></div>");
	$.each(data.buttons, function(index, button) {
		var $button = $("<button type='button' class='pb-btn pb-btn-default pb-chat-btn-live-preview' >" + button.title + "</button>");

		$button.click(function(e) { me.buttonClick(e, button); });
		$messageButtons.append($button);
	});
	$buttonContainer.append($messageText, $messageButtons);
	this.addMessageElement($buttonContainer, data);
};

ConverseWebClient.prototype.addDownloadMessage = function(data, options) {
	this.setWrapperItems(data);

	var $messageBodyDiv = $("<div class='pb-chat-direct-chat-text-" + data.direction + " pb-download'>");
	if (data.type.indexOf("image") === -1) {
		$messageBodyDiv.append(
			$("<div class='pb-download-name'>" + data.originalName + "</div><a target='_new' class='pb-download-link' href='" + this.converseHost + "/" + data.link + "' alt='" + this.downloadText + "'><span class='fas fa-file-download'></span></a>"));
	} else {
		$messageBodyDiv.append($("<img class='pb-chat-image' src='" + this.converseHost + "/" + data.link + "' alt='" + data.originalName + "'></img>"));
	}

	this.addMessageElement($messageBodyDiv, data);
};

ConverseWebClient.prototype.addChatMessage = function(data, options) {
	this.setWrapperItems(data);

	var ts = Date.now();

	data.__id = ts;
	this.incomingMessages[ts] = data;
	
	var $messageBodyDiv;
	if (data.message.trim().substring(0, 29) === "https://www.youtube.com/embed" && data.direction === "inbound") {
		var frame = $("<iframe>", {
			width: "100%",
			src: data.message,
			frameborder: 0,
			allow: "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture",
			allowfullscreen: true
		});
		$messageBodyDiv = $("<div class=\"pb-chat-direct-chat-text-" + data.direction + " \">");
		$messageBodyDiv.append(frame);
	} else if (ConverseUtil.isValidUrl(data.message.trim())) {
		var a = $("<a>", {
			href: data.message.trim(),
			class: "pb-rich-link-link",
			target: "_blank"
		});

		var imageContainer = $("<div>", {
			class: "pb-rich-link-image",
			css: {
				"display": "none"
			}
		});

		var title = $("<div>", {
			class: "pb-rich-link-title",
			text: data.message
		});

		var description = $("<div>", {
			class: "pb-rich-link-description"
		});

		a.append(imageContainer)
			.append(title)
			.append(description);

		$messageBodyDiv = $("<div class=\"pb-chat-direct-chat-text-" + data.direction + " \">");

		$messageBodyDiv.append(a);
	} else if (data.message.indexOf("data:image/") === 0) {
		$messageBodyDiv = $("<img class=\"pb-chat-direct-chat-text-" + data.direction + " \">")
			.src(data.message);
	} else if (this.allowHTML) {
		$messageBodyDiv = $("<div class=\"pb-chat-direct-chat-text-" + data.direction + " \">")
			.html(data.message);
	} else {
		$messageBodyDiv = $("<div class=\"pb-chat-direct-chat-text-" + data.direction + " \">")
			.text(data.message);
	}
	this.addMessageElement($messageBodyDiv, data);
};

ConverseWebClient.prototype.addMessageElement = function(el, data) {
	var $el = $(el);
	var me = this;
	$el.attr("data-timestamp", data.__id);
	$el.hide().fadeIn(this.FADE_TIME);
	this.lastContainerItems.append($el);

	$(me.baseContainer).find("#messagesWrapper").animate({
		scrollTop: $(me.baseContainer).find("#messagesWrapper").get(0).scrollHeight
	}, 100);

	this.onTypeOff();
};

ConverseWebClient.prototype.getTimeStamp = function() {
	var today = new Date();
	return today.toLocaleDateString(undefined, {
			year: "numeric",
			month: "2-digit",
			day: "2-digit"
		}) + " " +
		today.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit"
		});
};

ConverseWebClient.prototype.disableTextArea = function() {
	$(this.baseContainer).find("textarea")
		.attr("placeholder", this.disabledPlaceholder)
		.prop("disabled", true);

	$(this.baseContainer).find("#send").addClass("disabled");

	$(this.baseContainer).find(".pb-chat-toolbar-btn").addClass("pb-chat-toolbar-btn-disabled");
};

ConverseWebClient.prototype.enableTextArea = function() {
	$(this.baseContainer).find("textarea")
		.attr("placeholder", this.placeholder)
		.prop("disabled", false);

	$(this.baseContainer).find("#send").removeClass("disabled");

	$(this.baseContainer).find(".pb-chat-toolbar-btn").removeClass("pb-chat-toolbar-btn-disabled");
};
