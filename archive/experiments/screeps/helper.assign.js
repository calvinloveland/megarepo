/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('helper.assign');
 * mod.thing == 'a thing'; // true
 */
var getNumGather = function(room) {
    var resources = room.find(FIND_SOURCES_ACTIVE);
    var valid_spots = 0;
    for(var i in resources){
        var center = resources[i].pos;
        
            if(Game.map.getTerrainAt(center.x + 1, center.y + 1, room.name) != 'wall'){
                valid_spots++;
            }
            if(Game.map.getTerrainAt(center.x + 1, center.y, room.name) != 'wall'){
                valid_spots++;
            }
            if(Game.map.getTerrainAt(center.x + 1, center.y - 1, room.name) != 'wall'){
                valid_spots++;
            }
            if(Game.map.getTerrainAt(center.x, center.y + 1, room.name) != 'wall'){
                valid_spots++;
            }
            if(Game.map.getTerrainAt(center.x , center.y - 1, room.name) != 'wall'){
                valid_spots++;
            }
            if(Game.map.getTerrainAt(center.x - 1, center.y + 1, room.name) != 'wall'){
                valid_spots++;
            }
            if(Game.map.getTerrainAt(center.x - 1, center.y , room.name) != 'wall'){
                valid_spots++;
            }
            if(Game.map.getTerrainAt(center.x - 1, center.y - 1, room.name) != 'wall'){
                valid_spots++;
            }
        }
    return valid_spots;
};

var assigner = {
    assign : function(unemployed){
    unemployed.say("Job Time!");
    var harvesters = 0;
    var builders = 0;
    var upgraders = 0;
    var remoteHarvesters = 0;
    var miners = 0;
    for(var name in Game.creeps) {
		var creep = Game.creeps[name];
		if (creep.room === unemployed.room ){
		    if(creep.memory.role === "harvester"){
		        harvesters++;
		    }
		    else if(creep.memory.role === "upgrader"){
		        upgraders++;
		    }
		    else if(creep.memory.role ==="builder"){
		        builders++;
		    }
		    else if(creep.memory.role === "miner"){
		        miners++;
		    }
		    else if(creep.memory.role === "remoteHarvester"){
		        remoteHarvesters++;
		    }
		}
    }
    if(unemployed.room.controller == null || !unemployed.room.controller.my){
        unemployed.memory.role = "remoteHarvester";
    }
    else if(harvesters < (getNumGather(unemployed.room)*2)){
        unemployed.memory.role = "harvester";
    }
    else if(unemployed.room.controller.ticksToDowngrade < 4000 || unemployed.room.controller.level == 1){
        unemployed.memory.role = "upgrader";
    }
    else if(miners < 1 && unemployed.room.controller.level >= 6){
        unemployed.memory.role = "miner";
    }
    else if(upgraders + builders > 2){
        unemployed.memory.role = "remoteHarvester";
    }
    else{
    unemployed.memory.role = "builder";
}
}
}

module.exports = assigner