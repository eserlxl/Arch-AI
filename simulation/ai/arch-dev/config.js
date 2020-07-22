// Arch Based AI bots
// 		Admiral
// 		Capitalist
// 		Communist
// 		Imperialist
// 		Mercantilist
// 		Mason
// 		Patriot
// 		Theocrat
// 		Unitary

ARCH.Config = function (difficulty, behavior) {
	// 0: Sandbox
	// 1: Very Easy
	// 2: Easy
	// 3: Medium
	// 4: Hard
	// 5: Very Hard
	// 6-15: Insane I-X (only in ArchMod)
	this.difficulty = difficulty !== undefined ? difficulty : 3;

	// for instance "balanced", "aggressive" or "defensive"
	this.behavior = behavior || "random";

	this.phaseCount = 3;

	this.chat = true;	// false to prevent AI's chats

	this.popScaling = 1;	// scale factor depending on the max population

	this.Base = {
		"target": {
			"CivCentre": 1,
			"Colony": 1,
			"House": 4,
			"Field": 4,
			"Farmstead": 1,
			"Corral": 1,
			"Storehouse": 1,
			"BarterMarket": 1,
			"Dock": 1,
			"Temple": 1,
			"Barracks": 1,
			"Archery": 1,
			"Stables": 1,
			"Workshop": 1,
			"Blacksmith": 1,
			"ElephantStables": 1,
			"Fortress": 1,
			"SentryTower": 1,
			"StoneTower": 1,
			"Wonder": 1
		},
		"initialExpansionRate": {
			"CivCentre": 0.25,
			"Colony": 0.25,
			"House": 0.01,
			"Field": 0.05,
			"Farmstead": 0.15,
			"Corral": 0.15,
			"Storehouse": 0.25,
			"BarterMarket": 0.5,
			"Dock": 0.25,
			"Temple": 0.05,
			"Barracks": 0.3,
			"Archery": 0.3,
			"Stables": 0.25,
			"Workshop": 0.01,
			"Blacksmith": 0.01,
			"ElephantStables": 0.25,
			"Fortress": 0.5,
			"SentryTower": 0.125,
			"StoneTower": 0.25,
			"Wonder": 0
		},
		"plan": {
			"CivCentre": 0,
			"Colony": 0,
			"House": 0,
			"Field": 0,
			"Farmstead": 0,
			"Corral": 0,
			"Storehouse": 0,
			"BarterMarket": 0,
			"Dock": 0,
			"Temple": 0,
			"Barracks": 0,
			"Archery": 0,
			"Stables": 0,
			"Workshop": 0,
			"Blacksmith": 0,
			"ElephantStables": 0,
			"Fortress": 0,
			"SentryTower": 0,
			"StoneTower": 0,
			"Wonder": 0,
			"AdvancedBuilding": 0,
			"AdvancedMilitary": 0
		},
		"expectedPopulation": 50, // per base
		"expectedCCDistance": 300
	};

	this.Base.expansionRate = {};
	for (let type in this.Base.initialExpansionRate) {
		this.Base.expansionRate[type] = this.Base.initialExpansionRate[type];
	}

	/// Imperialist
	this.Base.target.CivCentre = 10;
	this.Base.target.Colony = 10;
	/// Imperialist

	// Note: attack settings are set directly in attack_plan.js
	this.Defence =
		{
			"defenceRatio": {"ally": 1.4, "neutral": 1.8, "own": 2},	// ratio of defenders/attackers.
			"armyCompactSize": 2000,	// squared. Half-diameter of an army.
			"armyBreakawaySize": 3500,	// squared.
			"armyMergeSize": 1400,	// squared.
			"bombingAttackPeriod": 5, // Turn
			"expectedDefenders": 3, // Defender count for each new construction
			"backupSize": 25,
			"rushProtectionTurn": 180 // AI game turns to protect against rush attacks
		};

	this.Economy = {
		"disableResourcePlaning": true,
		"maxTraderCount": 5,	// Target number of traders
		"expectedResource":
			{
				"food": 500,
				"wood": 500,
				"stone": 500,
				"metal": 500,
			},
		"maxFieldCount": 20
	};

	// Executing frequencies
	this.Frequency = {
		"base": 1 / 2,
		"construction": 1 / 2,
		"defence": 1 / 4,
		"diplomacy": 1 / 16,
		"expansion": 1 / 16,
		"military": 1 / 4,
		"navy": 1 / 4,
		"research": 1 / 4,
		"trading": 1 / 2,
		"training": 1 / 2,
		"victory": 1 / 16
	};

	this.Period = {};

	this.Military = {
		"relicSearchLatency": 30,
		"razeLostBuildings": true
	};

	this.Navy = {
		"targetNumFishers": 2,
		"targetNumTransportships": 2,
		"targetNumWarships": 5
	};

	this.Personality =
		{
			"random": randFloat(0, 1),
			"defensive": randFloat(0, 1),
			"balanced": randFloat(0, 1),
			"aggressive": randFloat(0, 1),
			"cooperative": randFloat(0, 1),

			// Setup personality traits according to the user choice:
			// The parameter used to define the personality is basically the aggressivity or (1-defensiveness)
			// as they are anticorrelated, although some small smearing to decorelate them will be added.
			// And for each user choice, this parameter can vary between min and max
			"model": {
				"random": {"min": 0, "max": 1},
				"defensive": {"min": 0, "max": 0.25},
				"balanced": {"min": 0.375, "max": 0.625},
				"aggressive": {"min": 0.75, "max": 1}
			}
		};

	// Additional buildings that the AI does not yet know when to build
	// and that it will try to build on phase 3 when enough resources.
	this.buildings =
		{
			"default": [],
			"athen": ["structures/{civ}_gymnasion", "structures/{civ}_prytaneion",
				"structures/{civ}_theatron", "structures/{civ}_royal_stoa"],
			"brit": ["structures/{civ}_rotarymill"],
			"cart": ["structures/{civ}_embassy_celtic", "structures/{civ}_embassy_iberian",
				"structures/{civ}_embassy_italiote"],
			"gaul": ["structures/{civ}_rotarymill", "structures/{civ}_tavern"],
			"iber": ["structures/{civ}_monument"],
			"kush": ["structures/{civ}_pyramid_large", "structures/{civ}_blemmye_camp",
				"structures/{civ}_nuba_village"],
			"mace": ["structures/{civ}_library", "structures/{civ}_theatron"],
			"maur": ["structures/{civ}_pillar_ashoka"],
			"pers": ["structures/{civ}_apadana", "structures/{civ}_hall"],
			"ptol": ["structures/{civ}_library"],
			"rome": ["structures/{civ}_army_camp"],
			"sele": ["structures/{civ}_library"],
			"spart": ["structures/{civ}_syssiton", "structures/{civ}_theatron",
				"structures/{civ}_royal_stoa"]
		};

	// Descending order for readability
	this.priorities =
		{
			"emergency": 0,    // used only in emergency situations, should be the highest one
			"civilCentre": 0,
			"house": 0,
			"hero": 0,
			"wonder": 0,
			"market": 0,
			"dock": 0,
			"majorTech": 0,
			"villager": 0,
			"guards": 0,
			"infantry": 0,
			"field": 0,
			"army": 0,
			"supportUnit": 0,
			"cavalry": 0,
			"trader": 0,
			"military": 0,
			"defence": 0,
			"healer": 0,
			"ship": 0,
			"farmStead": 0,
			"corral": 0,
			"dropsite": 0,
			"temple": 0,
			"minorTech": 0,
			"ships": 0,  // TODO: DELIST
			"dropsites": 0, // TODO: DELIST
			"economicBuilding": 0, // TODO: DELIST
			"militaryBuilding": 0, // TODO: DELIST
			"defenceBuilding": 0 // TODO: DELIST
		};

	let maxPriority = 1000;
	let minPriority = 250;
	let dPriority = (maxPriority - minPriority) / (Object.keys(this.priorities).length - 1);
	let iPriority = 0;
	for (let hash in this.priorities) {
		this.priorities[hash] = Math.round(maxPriority - iPriority * dPriority);
		++iPriority;
	}

	// A little confusion for easy AIs :)
	if (this.difficulty < 3) {
		for (let hash in this.priorities) {
			this.priorities[hash] = ARCH.limit(this.priorities[hash] - Math.pow(4 - this.difficulty, 3) * randIntExclusive(25, 50), 50, 1000);
		}
	}

	/// Theocrat
	this.priorities["temple"] = this.priorities["guards"] - 25;
	this.priorities["healer"] = this.priorities["healer"] - 50;
	/// Theocrat

	// See m.QueueManager.prototype.wantedGatherRates()
	this.queues =
		{
			"firstTurn": {
				"food": 10,
				"wood": 10,
				"default": 0
			},
			"short": {
				"food": 200,
				"wood": 200,
				"default": 100
			},
			"medium": {
				"food": 150,
				"wood": 200,
				"default": 200
			},
			"long": {
				"default": 0
			}
		};

	this.garrisonHealthLevel = {"low": 0.4, "medium": 0.55, "high": 0.7};
};

ARCH.Config.prototype.setConfig = function (gameState) {

	this.currentPhase = gameState.currentPhase();
	this.phaseCount = gameState.getNumberOfPhases();
	this.maxPop = gameState.getPopulationMax();
	this.popScaling = Math.sqrt(this.maxPop / 300);
	this.population = gameState.getPopulation();
	this.popRatio = this.population / Math.max(1, this.maxPop);

	let min = this.Personality[this.behavior] - this.Personality.model[this.behavior].min;
	let max = this.Personality.model[this.behavior].max;

	// Adaptive personality according to the population ratio
	this.Personality.aggressive = ARCH.interpolate(Math.sqrt(this.popRatio), 0, min, 1, max);
	this.Personality.defensive = ARCH.interpolate(Math.square(1 - this.popRatio), 0, 1 - max, 1, 1 - min);

	this.Base.expectedPopulation = this.maxPop * (0.4 - this.Personality.aggressive / 5);
	this.Base.expectedCCDistance = 300 - 40 * this.Personality.defensive;

	this.Defence.bombingAttackPeriod = 30 * (1 - 0.5 * this.Personality.aggressive) / (this.difficulty + 1);

	this.Defence.expectedDefenders = 3 + this.Personality.defensive * Math.min(5, this.difficulty - 3); // // Defender count for each new construction
	this.Defence.backupSize = this.Personality.defensive * this.popScaling * (5 * gameState.getNumPlayerEnemies() + 25);

	this.Economy.maxTraderCount = this.maxPop * (0.05 + 0.01 * this.difficulty) * this.popScaling;
	this.Economy.maxFieldCount = this.maxPop / 15 * this.currentPhase / this.phaseCount;

	let periodGain = (this.currentPhase + 2) / (this.difficulty + 1) / (2 - this.population / this.maxPop);
	for (let hash in this.Frequency) {
		this.Period[hash] = periodGain / this.Frequency[hash];
	}
	let personalityPeriodRelation = {
		"aggressive": ["expansion", "military", "navy"],
		"defensive": ["defence"],
		"cooperative": ["diplomacy"]
	};
	for (let personalityHash in personalityPeriodRelation) {
		for (let periodHash of personalityPeriodRelation[personalityHash]) {
			this.Period[periodHash] /= (this.Personality[personalityHash] + 1);
		}
	}

	let defaultRazeLostBuildingsDecision = this.difficulty > 2;
	this.Military.razeLostBuildings = defaultRazeLostBuildingsDecision;
	this.Military.relicSearchLatency = 240 - 30 * Math.min(5, this.difficulty - 3 * this.Personality.aggressive);

	if (gameState.playerData.teamsLocked) {
		this.Personality.cooperative = Math.min(1, this.Personality.cooperative + 0.30);
	} else if (gameState.getAlliedVictory()) {
		this.Personality.cooperative = Math.min(1, this.Personality.cooperative + 0.15);
	}
	let expansionRateGain = {};

	/// Admiral
	this.Base.expectedPopulation *= 0.25;
	expansionRateGain = {
		"CivCentre": 2,
		"Colony": 2,
		//"House": 1,
		"Field": 0.75,
		"Farmstead": 0.75,
		"Corral": 1.15,
		"Storehouse": 1.25,
		"BarterMarket": 1.25,
		"Dock": 3,
		"Temple": 0.25,
		"Barracks": 0.5,
		"Archery": 0.5,
		"Stables": 0.25,
		"Workshop": 0.5,
		"Blacksmith": 0.5,
		"ElephantStables": 0.25,
		"Fortress": 0.5,
		//"SentryTower": 1,
		"StoneTower": 2,
		//"Wonder": 1.5
	};

	this.Defence.expectedDefenders *= 0.25;
	this.Defence.backupSize *= 0.25;

	this.Economy.maxTraderCount *= 0.5;
	this.Economy.maxFieldCount *= 0.5;

	this.Period.base *= 1.5;
	this.Period.construction *= 1.5;
	this.Period.defence *= 1.5;
	this.Period.diplomacy *= 0.35;
	this.Period.expansion *= 0.25;
	this.Period.military *= 1.35;
	this.Period.navy = 0;
	this.Period.research *= 1.25;
	this.Period.trading *= 0.25;
	this.Period.training *= 1.15;
	this.Period.victory *= 1.05;

	this.Military.razeLostBuildings = defaultRazeLostBuildingsDecision;
	this.Navy.targetNumWarships = 4 * this.currentPhase;
	this.Navy.targetNumTransportships = 2;
	this.Navy.targetNumFishers = 3;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0.15, 0.85);
	/// Admiral

	/// Capitalist
	this.Base.expectedPopulation *= 1.25;
	expansionRateGain = {
		"CivCentre": 1.5,
		"Colony": 1.5,
		//"House": 1,
		"Field": 1.25,
		"Farmstead": 1.25,
		"Corral": 1.25,
		"Storehouse": 1.25,
		"BarterMarket": 1.15,
		"Dock": 1.25,
		"Temple": 0.05,
		"Barracks": 0.5,
		"Archery": 0.5,
		"Stables": 0.5,
		"Workshop": 0.05,
		"Blacksmith": 0.05,
		"ElephantStables": 0.5,
		"Fortress": 0.5,
		//"SentryTower": 1,
		"StoneTower": 0.5,
		//"Wonder": 0.75
	};

	this.Defence.expectedDefenders *= 1.5;
	this.Defence.backupSize *= 1.5;

	this.Economy.maxTraderCount *= 1.5;
	this.Economy.maxFieldCount *= 1.1;

	this.Period.base *= 0.5;
	this.Period.construction *= 0.5;
	this.Period.defence *= 2.5;
	this.Period.diplomacy *= 0.5;
	this.Period.expansion *= 0.5;
	this.Period.military *= 2.5;
	this.Period.navy *= 1.5;
	this.Period.research *= 0.5;
	this.Period.trading *= 0.5;
	this.Period.training *= 1.5;
	this.Period.victory *= 0.5;

	this.Military.razeLostBuildings = defaultRazeLostBuildingsDecision;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0.25, 0.75);
	/// Capitalist

	/// Communist
	this.Base.expectedPopulation *= 1.5;
	expansionRateGain = {
		"CivCentre": 0.5,
		"Colony": 0.5,
		//"House": 1,
		"Field": 2,
		"Farmstead": 2,
		"Corral": 1.25,
		"Storehouse": 1.5,
		"BarterMarket": 0.5,
		"Dock": 1.5,
		"Temple": 0,
		"Barracks": 2.5,
		"Archery": 2.5,
		"Stables": 2.25,
		"Workshop": 1.5,
		"Blacksmith": 1.5,
		"ElephantStables": 1.5,
		"Fortress": 2,
		//"SentryTower": 1,
		"StoneTower": 5,
		//"Wonder": 10
	};

	this.Defence.expectedDefenders *= 1.3;
	this.Defence.backupSize *= 1.2;

	this.Economy.maxTraderCount *= 0.5;
	this.Economy.maxFieldCount *= 1.25;

	this.Period.base *= 0.8;
	this.Period.construction *= 0.5;
	this.Period.defence *= 0.7;
	this.Period.diplomacy *= 1.2;
	this.Period.expansion *= 10;
	this.Period.military *= 0.9;
	this.Period.navy *= 0.9;
	this.Period.research *= 1.2;
	this.Period.trading *= 2;
	this.Period.training *= 0.7;
	this.Period.victory *= 1.2;

	this.Military.razeLostBuildings = false;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0.25, 0.75);
	/// Communist

	/// Imperialist
	this.Base.expectedPopulation *= 0.5;
	expansionRateGain = {
		"CivCentre": 2,
		"Colony": 2,
		//"House": 1,
		"Field": 0.5,
		"Farmstead": 0.5,
		"Corral": 0.5,
		"Storehouse": 1.5,
		"BarterMarket": 1.25,
		"Dock": 2,
		"Temple": 1.25,
		"Barracks": 0.5,
		"Archery": 0.5,
		"Stables": 1.25,
		"Workshop": 1.25,
		"Blacksmith": 1.25,
		"ElephantStables": 1.5,
		"Fortress": 1.25,
		//"SentryTower": 1,
		"StoneTower": 1.25,
		//"Wonder": 1.5
	};

	this.Defence.expectedDefenders *= 0.5;
	this.Defence.backupSize *= 0.5;

	this.Economy.maxTraderCount *= 1.25;
	this.Economy.maxFieldCount *= 0.85;

	this.Period.base *= 1.25;
	this.Period.construction *= 0.95;
	this.Period.defence *= 1.5;
	this.Period.diplomacy *= 0.5;
	this.Period.expansion *= 0.5;
	this.Period.military *= 0.9;
	this.Period.navy *= 0.75;
	this.Period.research *= 0.5;
	this.Period.trading *= 0.5;
	this.Period.training *= 0.85;
	this.Period.victory *= 0.85;

	this.Military.razeLostBuildings = defaultRazeLostBuildingsDecision;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0.35, 1);
	/// Imperialist

	/// Mason
	this.Base.expectedPopulation *= 0.77;
	expansionRateGain = {
		"CivCentre": 1.77,
		"Colony": 1.77,
		//"House": 1.77,
		"Field": 0.77,
		"Farmstead": 0.77,
		"Corral": 0.77,
		"Storehouse": 0.77,
		"BarterMarket": 0.77,
		"Dock": 1.77,
		"Temple": 1.77,
		"Barracks": 1.77,
		"Archery": 1.77,
		"Stables": 1.77,
		"Workshop": 0.77,
		"Blacksmith": 0.77,
		"ElephantStables": 1.77,
		"Fortress": 1.77,
		//"SentryTower": 1.77,
		"StoneTower": 1.77,
		//"Wonder": 0.77
	};

	this.Defence.expectedDefenders *= 0.77;
	this.Defence.backupSize *= 0.77;

	this.Economy.maxTraderCount *= 0.77;
	this.Economy.maxFieldCount *= 0.77;

	this.Period.base *= 0.77;
	this.Period.construction *= 0.77;
	this.Period.defence *= 1.77;
	this.Period.diplomacy *= 0.77;
	this.Period.expansion *= 1.77;
	this.Period.military *= 1.77;
	this.Period.navy *= 1.77;
	this.Period.research *= 0.77;
	this.Period.trading *= 0.77;
	this.Period.training *= 0.77;
	this.Period.victory *= 1.77;


	this.Military.razeLostBuildings = defaultRazeLostBuildingsDecision;
	this.Personality.cooperative = 1;
	/// Mason

	/// Mercantilist
	this.Base.expectedPopulation *= 1.5;
	expansionRateGain = {
		"CivCentre": 0.5,
		"Colony": 0.5,
		//"House": 1,
		"Field": 1.5,
		"Farmstead": 1.5,
		"Corral": 1.5,
		"Storehouse": 1.5,
		"BarterMarket": 1.5,
		"Dock": 1.5,
		"Temple": 0.5,
		"Barracks": 0.75,
		"Archery": 0.75,
		"Stables": 0.75,
		"Workshop": 0.25,
		"Blacksmith": 0.25,
		"ElephantStables": 0.75,
		"Fortress": 0.5,
		//"SentryTower": 1,
		"StoneTower": 0.5,
		//"Wonder": 0.75
	};

	this.Defence.expectedDefenders *= 1.25;
	this.Defence.backupSize *= 1.25;

	this.Economy.maxTraderCount *= 2;
	this.Economy.maxFieldCount *= 1.05;

	this.Period.base *= 0.85;
	this.Period.construction *= 1.05;
	this.Period.defence *= 0.85;
	this.Period.diplomacy *= 0.5;
	this.Period.expansion *= 1.5;
	this.Period.military *= 1.15;
	this.Period.navy *= 0.5;
	this.Period.research *= 1.05;
	this.Period.trading = 0;
	this.Period.training *= 1.5;
	this.Period.victory *= 1.5;

	this.Military.razeLostBuildings = defaultRazeLostBuildingsDecision;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0.5, 1);
	/// Mercantilist

	/// Patriot
	this.Base.expectedPopulation *= 2;
	expansionRateGain = {
		"CivCentre": 0.25,
		"Colony": 0.25,
		//"House": 1,
		"Field": 0.5,
		"Farmstead": 0.5,
		"Corral": 0.75,
		"Storehouse": 0.75,
		"BarterMarket": 0.5,
		"Dock": 0.5,
		"Temple": 1.5,
		"Barracks": 2.5,
		"Archery": 2.5,
		"Stables": 1.5,
		"Workshop": 0.05,
		"Blacksmith": 0.05,
		"ElephantStables": 1.5,
		"Fortress": 10,
		//"SentryTower": 1,
		"StoneTower": 10,
		//"Wonder": 5
	};

	this.Defence.expectedDefenders *= 1.5;
	this.Defence.backupSize *= 1.35;

	this.Economy.maxTraderCount *= 0.75;
	this.Economy.maxFieldCount *= 1.15;

	this.Period.base = 0;
	this.Period.construction *= 0.5;
	this.Period.defence *= 0.25;
	this.Period.diplomacy *= 5;
	this.Period.expansion *= 10;
	this.Period.military *= 0.5;
	this.Period.navy *= 3;
	this.Period.research *= 1.25;
	this.Period.trading *= 1.5;
	this.Period.training *= 0.5;
	this.Period.victory *= 2;

	this.Military.razeLostBuildings = false;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0, 0.5);
	/// Patriot

	/// Unitary
	expansionRateGain = {
		"CivCentre": 0,
		"Colony": 0,
		//"House": 1,
		"Field": 1,
		"Farmstead": 1,
		"Corral": 1,
		"Storehouse": 1,
		"BarterMarket": 1,
		"Dock": 1,
		"Temple": 1,
		"Barracks": 1,
		"Archery": 1,
		"Stables": 1,
		"Workshop": 1,
		"Blacksmith": 1,
		"ElephantStables": 1,
		"Fortress": 1,
		//"SentryTower": 1,
		"StoneTower": 1,
		"Wonder": 1
	};

	this.Defence.expectedDefenders *= 1.5;
	this.Defence.backupSize *= 1.35;

	this.Economy.maxTraderCount *= 0.75;
	this.Economy.maxFieldCount *= 1.15;

	this.Period.base *= 0.5;
	this.Period.construction *= 0.5;
	this.Period.defence = 0;
	this.Period.diplomacy *= 5;
	this.Period.expansion *= 100;
	this.Period.military *= 1.25;
	this.Period.navy *= 5;
	this.Period.research *= 1.5;
	this.Period.trading *= 1.25;
	this.Period.training *= 0.25;
	this.Period.victory *= 10;

	this.Military.razeLostBuildings = false;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0, 0.25);
	/// Unitary

	/// Theocrat
	this.Base.expectedPopulation *= 1.9;
	expansionRateGain = {
		"CivCentre": 0.19,
		"Colony": 0.19,
		//"House": 0.19,
		"Field": 0.19,
		"Farmstead": 0.19,
		"Corral": 0.19,
		"Storehouse": 0.19,
		"BarterMarket": 0.19,
		"Dock": 0.19,
		"Temple": 1.9,
		"Barracks": 0.19,
		"Archery": 0.19,
		"Stables": 0.19,
		"Workshop": 0.19,
		"Blacksmith": 0.19,
		"ElephantStables": 0.19,
		"Fortress": 1.9,
		//"SentryTower": 1.9,
		"StoneTower": 1.9,
		//"Wonder": 19
	};

	this.Defence.expectedDefenders *= 1.9;
	this.Defence.backupSize *= 1.9;

	this.Economy.maxTraderCount *= 0.19;
	this.Economy.maxFieldCount *= 1.25;

	this.Period.base *= 1.9;
	this.Period.construction *= 0.19;
	this.Period.defence *= 0.19;
	this.Period.diplomacy *= 1.9;
	this.Period.expansion *= 1.9;
	this.Period.military *= 1.9;
	this.Period.navy *= 1.9;
	this.Period.research = 0;
	this.Period.trading *= 1.9;
	this.Period.training *= 1.9;
	this.Period.victory *= 1.9;

	this.Military.razeLostBuildings = false;
	this.Personality.cooperative = ARCH.limit(this.Personality.cooperative, 0.38, 0.76);
	/// Theocrat

	// Regardless of the character, max field count should be at least 8!
	this.Economy.maxFieldCount = Math.max(8, this.Economy.maxFieldCount);

	let difficultyDivider = Math.max(1, Math.pow(4 - this.difficulty, 2));
	for (let gainHash in expansionRateGain) {
		this.Base.expansionRate[gainHash] = expansionRateGain[gainHash] * this.Base.initialExpansionRate[gainHash] / difficultyDivider;
	}
/// DEBUG
	gameState.ai.logger.push("INFO", "Config", "AI personality: " + uneval(this.Personality));
/// DEBUG
};

///
ARCH.Config.prototype.Serialize = function () {
	let data = {};
	for (let key in this)
		if (this.hasOwnProperty(key) && key !== "debug")
			data[key] = this[key];
	return data;
};

ARCH.Config.prototype.Deserialize = function (data) {
	for (let key in data)
		this[key] = data[key];
};
///
