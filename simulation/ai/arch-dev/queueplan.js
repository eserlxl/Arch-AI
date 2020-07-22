/**
 * Common functions and variables to all queue plans.
 * @return {boolean}
 */

ARCH.QueuePlan = function (gameState, type, metadata) {
	this.type = gameState.applyCiv(type);
	this.metadata = metadata;

	this.template = gameState.getTemplate(this.type);
	if (!this.template) {
/// DEBUG
		gameState.ai.logger.push("ERROR", "QueuePlan", "Template couldn't be fetched. Tried to add to the unknown template: " + this.type);
/// DEBUG
		return false;
	}
	this.ID = gameState.ai.uniqueIDs.plans++;
	this.cost = new API3.Resources(this.template.cost());
	this.number = 1;
	this.category = "";

	return true;
};

/* Check the content of this queue */
ARCH.QueuePlan.prototype.isInvalid = function (gameState) {
/// DEBUG
	gameState.ai.logger.push("DEBUG", "QueuePlan", "The queue plan is invalid.");
/// DEBUG
	return false;
};

/* can we start this plan immediately? */
ARCH.QueuePlan.prototype.canStart = function (gameState) {
/// DEBUG
	gameState.ai.logger.push("DEBUG", "QueuePlan", "The queue plan can be started.");
/// DEBUG
	return false;
};

/** process the plan. */
ARCH.QueuePlan.prototype.start = function (gameState) {
/// DEBUG
	gameState.ai.logger.push("DEBUG", "QueuePlan", "The queue plan started.");
/// DEBUG
	// should call onStart.
};

ARCH.QueuePlan.prototype.getCost = function () {
	let costs = new API3.Resources();
	costs.add(this.cost);
	if (this.number !== 1)
		costs.multiply(this.number);
	return costs;
};

/**
 * On Event functions.
 * Can be used to do some specific stuffs
 * Need to be updated to actually do something if you want them to.
 * this is called by "Start" if it succeeds.
 */
ARCH.QueuePlan.prototype.onStart = function (gameState) {
/// DEBUG
	gameState.ai.logger.push("DEBUG", "QueuePlan", "Queue plan is ready to start: " + this.type);
/// DEBUG
};
