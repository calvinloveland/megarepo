// Instantiation code

var roleBuilder = require("role.builder");
var roleHarvester = require("role.harvester");
var roleUpgrader = require("role.upgrader");
var roleClaimer = require("role.claimer");
var roleHomesteader = require("role.homesteader");
var roleBerserker = require("role.berserker");
var roleTower = require("role.tower");
var roleScout = require("role.scout");
var roleLink = require("role.link");
var roleRemoteHarvester = require("role.remoteHarvester");
var roleMiner = require("role.miner");
var roleTerminal = require("role.terminal");

var creepBuilder = require("helper.creepBuilder");
var assigner = require("helper.assign");
var constructer = require("helper.construct");

var phrases = ["乇乂ㄒ尺卂ㄒ卄丨匚匚", "Greeting","Harvesting","Building","Upgrading","Fighting","Scouting","Linking","Hiding","Asking",
    "Abiding","Abolishing","Aborting","Adapting","Adding","Aging","Baking","Baiting","Balding","Boating","Bowing",
    "Churning","Circling","Cleaning","Coming","Duckling","Dueling","Expanding","Farming","Falling","Felting",
    "Fibbing","Flexing","Teaming","Healing","Running","Creeping","Showing","Parking","Camping","🍆💦💦💦😂"];
    
var commandments = [
    "🎅🙅👹🙅👳",
    "🙅🐮🙅🗿🙅",
    "🚫😠💬🔥⚡",
    "😊💭⛪️🕍👍",
    "❤️️👨❤️️🤰❤️️️️",
    "🔪😱➡️💀🚫",
    "👰🍆💦🤰🚫",
    "😨💰🔫😠🚫",
    "🤞😮📢🤔🚫",
    "😩💰👯🏡🚫",
    ];
var verbose = true;

module.exports.loop = function () {
    if(Game.cpu.bucket > 500){
    
    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            if(name === "Scout Curly"){
                Memory.scouting = false;
            }
            delete Memory.creeps[name];
            console.log('RIPERONI:', name);
        }
    }
    var total = 0;
	for(var name in Game.creeps) {
	    
	    total++;
		var creep = Game.creeps[name];
		if(verbose && Math.random()>.98){
		    creep.say(phrases[Math.floor(Math.random()*phrases.length)],true)
		}
        if(creep.memory.role === "builder"){
		    roleBuilder.run(creep);
		}
		else if(creep.memory.role === "harvester"){
		    roleHarvester.run(creep);
		}
		else if(creep.memory.role === "Jesus"){
		    creep.say(commandments[Math.floor(Math.random()*commandments.length)],true,true)
		    roleHarvester.run(creep);
		}
		else if(creep.memory.role === "upgrader"){
		    roleUpgrader.run(creep);
		}
		else if(creep.memory.role === "claimer"){
		    roleClaimer.run(creep);
		    total--;
		}
		else if(creep.memory.role === "homesteader"){
		    roleHomesteader.run(creep);
		    total = total - 3;
		}
		else if(creep.memory.role === "berserker"){
		    roleBerserker.run(creep);
		    total = total - 3;
		}
		else if(creep.memory.role === "scout"){
		    roleScout.run(creep);
		}
		else if(creep.memory.role === "remoteHarvester"){
		    roleRemoteHarvester.run(creep);
		}
		else if(creep.memory.role ==="miner"){
		    roleMiner.run(creep);
		} 
	}
	
	    
	    for (var name in Game.structures){
	        var struct = Game.structures[name];
	        if(struct.structureType === STRUCTURE_TOWER){
                roleTower.run(struct);
	        }
	        else if(struct.structureType === STRUCTURE_LINK){
	            roleLink.run(struct);
	        }
	        else if(struct.structureType === STRUCTURE_TERMINAL && Game.time % 1000 === 1){
	            roleTerminal.run(struct);
	        }
        }
	
	for(var name in Game.creeps) {
	    var creep = Game.creeps[name];
	    if (creep.memory.role === "none"){
		       assigner.assign(creep);
		}
	}
	
	
	for(var name in Game.spawns){
	    var spawn = Game.spawns[name];
	    creepBuilder.doit(spawn);
	    if(Game.time % 1000 === 0){
	        console.log("Constructing");
	        constructer.doit(spawn);
	    }
	    if(Game.flags.ClaimThis != null && Game.flags.ClaimThis.color === COLOR_BLUE && spawn.room === Game.flags.ClaimThis.room){
	        Game.flags.ClaimThis.setColor(COLOR_WHITE);
	    }
	}
    }
    else{
        console.log("Not enough CPU");
    }
}