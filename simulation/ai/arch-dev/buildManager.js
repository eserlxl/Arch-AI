/**
 * One task of this manager is to cache the list of structures we have builders for,
 * to avoid having to loop on all entities each time.
 * It also takes care of the structures we can't currently build and should not try to build endlessly.
 */

ARCH.BuildManager = function () {
	// List of buildings we have builders for, with number of possible builders.
	this.builderCounters = new Map();
	// List of buildings we can't currently build (because no room, no builder or whatever),
	// with time we should wait before trying again to build it.
	this.unbuildables = new Map();
};

/** Initialization at start of game */
ARCH.BuildManager.prototype.init = function (gameState) {
	let civ = gameState.getPlayerCiv();
	for (let ent of gameState.getOwnUnits().values())
		this.incrementBuilderCounters(civ, ent, 1);
};

ARCH.BuildManager.prototype.incrementBuilderCounters = function (civ, ent, increment) {
	for (let buildable of ent.buildableEntities(civ)) {
		if (this.builderCounters.has(buildable)) {
			let count = this.builderCounters.get(buildable) + increment;
			if (count < 0) {
/// DEBUG
				gameState.ai.logger.push("ERROR", "BuildManager", "IncrementBuilderCounters for " + buildable + " with count < 0");
/// DEBUG
				continue;
			}
			this.builderCounters.set(buildable, count);
		} else if (increment > 0) {
			this.builderCounters.set(buildable, increment);
		}
/// DEBUG
		else {
			gameState.ai.logger.push("ERROR", "BuildManager", "IncrementBuilderCounters for " + buildable + " not yet set");
		}
/// DEBUG
	}
};

/** Update the builders counters */
ARCH.BuildManager.prototype.checkEvents = function (gameState, events) {
	this.elapsedTime = gameState.ai.elapsedTime;
	let civ = gameState.getPlayerCiv();

	for (let evt of events.Create) {
		if (events.Destroy.some(e => e.entity === evt.entity))
			continue;
		let ent = gameState.getEntityById(evt.entity);
		if (ent && ent.isOwn(PlayerID) && ent.hasClass("Unit"))
			this.incrementBuilderCounters(civ, ent, 1);
	}

	for (let evt of events.Destroy) {
		if (events.Create.some(e => e.entity === evt.entity) || !evt.entityObj)
			continue;
		let ent = evt.entityObj;
		if (ent && ent.isOwn(PlayerID) && ent.hasClass("Unit"))
			this.incrementBuilderCounters(civ, ent, -1);
	}

	for (let evt of events.OwnershipChanged)   // capture events
	{
		let increment;
		if (evt.from === PlayerID)
			increment = -1;
		else if (evt.to === PlayerID)
			increment = 1;
		else
			continue;
		let ent = gameState.getEntityById(evt.entity);
		if (ent && ent.hasClass("Unit"))
			this.incrementBuilderCounters(civ, ent, increment);
	}
};


/**
 * Get the first buildable structure with a given class
 * TODO when several available, choose the best one
 */
ARCH.BuildManager.prototype.findStructureWithClass = function (gameState, classes) {
	for (let [templateName, count] of this.builderCounters) {
		if (count === 0 || gameState.isTemplateDisabled(templateName))
			continue;
		let template = gameState.getTemplate(templateName);
		if (!template || !template.available(gameState))
			continue;
		if (MatchesClassList(template.classes(), classes))
			return templateName;
	}
	return undefined;
};

ARCH.BuildManager.prototype.hasBuilder = function (template) {
	let numBuilders = this.builderCounters.get(template);
	return numBuilders && numBuilders > 0;
};

ARCH.BuildManager.prototype.isUnbuildable = function (gameState, template) {
	return this.unbuildables.has(template) && this.unbuildables.get(template).time > gameState.ai.elapsedTime;
};

ARCH.BuildManager.prototype.setBuildable = function (template) {
	if (this.unbuildables.has(template))
		this.unbuildables.delete(template);
};

/** Time is the duration in second that we will wait before checking again if it is buildable */
ARCH.BuildManager.prototype.setUnbuildable = function (gameState, template, time = 90, reason = "room") {
	if (!this.unbuildables.has(template))
		this.unbuildables.set(template, {"reason": reason, "time": gameState.ai.elapsedTime + time});
	else {
		let unbuildable = this.unbuildables.get(template);
		if (unbuildable.time < gameState.ai.elapsedTime + time) {
			unbuildable.reason = reason;
			unbuildable.time = gameState.ai.elapsedTime + time;
		}
	}
};

/** Return the number of unbuildables due to missing room */
ARCH.BuildManager.prototype.numberMissingRoom = function (gameState) {
	let num = 0;
	for (let unbuildable of this.unbuildables.values())
		if (unbuildable.reason === "room" && unbuildable.time > gameState.ai.elapsedTime)
			++num;
	return num;
};

/** Reset the unbuildables due to missing room */
ARCH.BuildManager.prototype.resetMissingRoom = function (gameState) {
	for (let [key, unbuildable] of this.unbuildables)
		if (unbuildable.reason === "room")
			this.unbuildables.delete(key);
};

///
ARCH.BuildManager.prototype.Serialize = function () {
	return {
		"builderCounters": this.builderCounters,
		"unbuildables": this.unbuildables
	};
};

ARCH.BuildManager.prototype.Deserialize = function (data) {
	for (let key in data)
		this[key] = data[key];
};
///
