/*
    Arch AI by Eser KUBALI ( Archbot @ 0 A.D. Forum )

      Many thanks to the developers of Petra AI!
-----------------------------------------------------------------------

0 A.D. is a free and open source historical Real Time Strategy (RTS) game developed by Wildfire Games.

Petra is the default AI bot of the 0 A.D. Arch AI (ArchBot) is a modified version of Petra AI.

The original source code of the Petra AI can be downloaded from <https://www.wildfiregames.com/>
 or can be obtained from the game data folder: simulation/ai/petra/

The modified and new files are Copyright (C) 2020 Eser KUBALI

Arch AI is a free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 2 of the License, or
(at your option) any later version.

	The Arch AI is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

	You can find a copy of the GNU General Public License from  <https://www.gnu.org/licenses/>
	or from the same directory of this file.
*/

Engine.IncludeModule("common-api");

let ARCH = {};

ARCH.ArchBot = function ArchBot(settings) {
	API3.BaseAI.call(this, settings);

	this.playedTurn = 0;
	this.elapsedTime = 0;

	this.uniqueIDs = {
		"armies": 1,	// starts at 1 to allow easier tests on armies ID existence
		"bases": 1,	// base manager ID starts at one because "0" means "no base" on the map
		"plans": 0,	// training/building/research plans
		"transports": 1	// transport plans start at 1 because 0 might be used as none
	};

	this.Config = new ARCH.Config(settings.difficulty, settings.behavior);

	this.savedEvents = {};
};

ARCH.ArchBot.prototype = new API3.BaseAI();


ARCH.ArchBot.prototype.CustomInit = function (gameState) {
	///
	if (this.isDeserialized) {
		// WARNING: the deserializations should not modify the metadatas infos inside their init functions
		this.turn = this.data.turn;
		this.playedTurn = this.data.playedTurn;
		this.elapsedTime = this.data.elapsedTime;
		this.savedEvents = this.data.savedEvents;
		for (let key in this.savedEvents) {
			for (let i in this.savedEvents[key]) {
				if (!this.savedEvents[key][i].entityObj)
					continue;
				let evt = this.savedEvents[key][i];
				let evtmod = {};
				for (let keyevt in evt) {
					evtmod[keyevt] = evt[keyevt];
					evtmod.entityObj = new API3.Entity(gameState.sharedScript, evt.entityObj);
					this.savedEvents[key][i] = evtmod;
				}
			}
		}

		this.Config.Deserialize(this.data.config);

		this.queueManager = new ARCH.QueueManager(this.Config, {});
		this.queueManager.Deserialize(gameState, this.data.queueManager);
		this.queues = this.queueManager.queues;

		this.HQ = new ARCH.HQ(this.Config);
		this.HQ.init(gameState, this.queues);
		this.HQ.Deserialize(gameState, this.data.HQ);

		this.uniqueIDs = this.data.uniqueIDs;
		this.isDeserialized = false;
		this.data = undefined;

		// initialisation needed after the completion of the deserialization
		this.HQ.postinit(gameState);
	} else {
		///

		/// DEBUG
		this.logger = new ARCH.Logger();
		/// DEBUG

		this.Config.setConfig(gameState);

		// this.queues can only be modified by the queue manager or things will go awry.
		this.queues = {};
		for (let i in this.Config.priorities)
			this.queues[i] = new ARCH.Queue();

		this.queueManager = new ARCH.QueueManager(this.Config, this.queues);

		this.queueManager.init(this.gameState);

		this.HQ = new ARCH.HQ(this.Config);

		this.HQ.init(gameState, this.queues);

		// Analyze our starting position and set a strategy
		this.HQ.gameAnalysis(gameState);

		///
	}
	///
};

ARCH.ArchBot.prototype.OnUpdate = function (sharedScript) {
	if (this.gameFinished)
		return;

	for (let i in this.events) {
		if (i === "AIMetadata")   // not used inside AI
			continue;
		if (this.savedEvents[i] !== undefined)
			this.savedEvents[i] = this.savedEvents[i].concat(this.events[i]);
		else
			this.savedEvents[i] = this.events[i];
	}

	// Run the update every n turns, offset depending on player ID to balance the load
	this.elapsedTime = this.gameState.getTimeElapsed() / 1000;
	if (this.gameState.getOwnEntities().length > 0 // AI cannot do anything without any entities to control
		&& (!this.playedTurn || (this.turn + this.player) % 8 === 5)
	) {
///
		Engine.ProfileStart("ArchBot bot (player " + this.player + ")");
///
		this.playedTurn++;

		// Adaptive AI
		this.Config.setConfig(this.gameState);

		this.HQ.update(this.gameState, this.queues, this.savedEvents);

		this.queueManager.update(this.gameState);

		/// DEBUG
		this.logger.update();
		/// DEBUG

		for (let i in this.savedEvents)
			this.savedEvents[i] = [];
///
		Engine.ProfileStop();
///
	}

	this.turn++;
};

///
ARCH.ArchBot.prototype.Serialize = function () {
	let savedEvents = {};
	for (let key in this.savedEvents) {
		savedEvents[key] = this.savedEvents[key].slice();
		for (let i in savedEvents[key]) {
			if (!savedEvents[key][i].entityObj)
				continue;
			let evt = savedEvents[key][i];
			let evtmod = {};
			for (let keyevt in evt)
				evtmod[keyevt] = evt[keyevt];
			evtmod.entityObj = evt.entityObj._entity;
			savedEvents[key][i] = evtmod;
		}
	}

	return {
		"uniqueIDs": this.uniqueIDs,
		"turn": this.turn,
		"playedTurn": this.playedTurn,
		"elapsedTime": this.elapsedTime,
		"savedEvents": savedEvents,
		"config": this.Config.Serialize(),
		"queueManager": this.queueManager.Serialize(),
		"HQ": this.HQ.Serialize()
	};
};

ARCH.ArchBot.prototype.Deserialize = function (data, sharedScript) {
	this.isDeserialized = true;
	this.data = data;
};
///
