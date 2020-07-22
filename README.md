# Arch AI (Archbot)
0 A.D. is a free and open source historical Real Time Strategy (RTS) game developed by Wildfire Games.

Petra is the default AI bot of the 0 A.D. **Arch AI (ArchBot) is a modified version of Petra AI.**

The original source code of the Petra AI can be downloaded from <https://www.wildfiregames.com/>
 or can be obtained from the game data folder: simulation/ai/petra/

## Arch AI Pack
Arch AI bots are distributed as a pack that consists of 9 Arch based and 4 Petra based bots.

### Arch Based AI Bots
Arch based AI bots use Arch AI architecture.
- Admiral
- Capitalist
- Communist
- Imperialist
- Mason
- Mercantilist
- Patriot
- Theocrat
- Unitary
### Petra Based AI Bots
Petra based AI bots use the original Petra AI architecture.
- Imperialist
- Patriot
- Single Based
- Unitary

## Arch AI Architecture
Although Arch AI is a modified version of the Petra AI, now it is based on a different AI architecture due to many modifications and improvements.  

The main differences are:

### New Attack Plans
Normal and Huge attacks are not used anymore by Arch AI. New Attack types: Naval, Check and Mate.

### Naval Attack
Arch AI can start a Naval attack using the Warships.

### Base Expansion Mechanism
Arch AI continues to construct buildings and try to expand during the whole game.

### New Priority List
Arch AI uses a different priority list that includes infantry, guards and army to improve unit production rate and 
includes several construction queues that optimizes building construction. 

### New AI Managers

#### Construct Manager
The Construct Manager controls all the construction plans according to the necessity of the buildings.

#### Training Manager
The Training Manager controls all the unit productions except ships and traders.

#### Resource Manager
The Resource Manager controls the field count, corral and workers.

### Synchronisation Engine
Arch AI uses AI played turn variable as a reference to run AI managers like Petra does. 
However, the frequencies of the managers are different, controlled by config.js and are not constant during the game.

### Disabled Resource Planing
Arch AI disables Resource Planing in Queue Manager to improve unit production and construction rates.

### More Effective Barter Trading
Barter trading policy is totally different from Petra. Contingency trading was cancelled. There's no exception for food buy rate.

### New City Plan
Arch AI uses a new city plan to construct buildings. If Arch AI couldn't find a suitable location for construction, it uses the original city plan as a fail-over mechanism.

### Adaptive AI Personality Adjustment
Arch AI changes its personality during the game according to the population from defensive to aggressive or inverse.

## Installation

### For Users
You can download the release versions from release directory. Extract the release version and copy the ArchAIPack directory to the mods directory ( ../0ad/data/mods/ ).
### For Developers
Arch install script generates 9 Arch based AI bots (Admiral, Capitalist, Communist, Imperialist, Mason, Mercantilist, Patriot, Theocrat and Unitary) and 4 Petra based AI bots (Imperialist, Patriot, Single Based and Unitary).
~~~~
cd install
sh arch.sh
~~~~
The script finally packs and compresses the mod as a single tar.gz file.
## Supported Versions
- 0ad-23-1
- 0ad-23-2