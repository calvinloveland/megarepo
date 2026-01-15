var findSource = require("helper.findSource");

var roleHarvester = {

    /** @param {Creep} creep **/
    run: function(creep) {
        if(typeof(creep.memory.favoriteSource) === "undefined"){
            creep.memory.favoriteSource = 0;
        }
	    if((creep.carry.energy < creep.carryCapacity && creep.memory.harvesting === true) || creep.carry.energy === 0) {
	        creep.memory.harvesting = true;
	        
            findSource.doIt(creep);
        }
        else {
            creep.memory.harvesting = false;
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION  && structure.energy < structure.energyCapacity);
                    }
            });
            if(targets.length === 0 || creep.room.memory.creepCount > 5){
                 targets.push(...creep.room.find(FIND_STRUCTURES, {
                        filter: (structure) => {
                            return ((structure.structureType == STRUCTURE_SPAWN || structure.structureType === STRUCTURE_TOWER|| structure.structureType === STRUCTURE_LINK) &&
                                structure.energy < structure.energyCapacity) || (structure.structureType === STRUCTURE_TERMINAL && structure.store[RESOURCE_ENERGY] < 10000);
                        }
                }));
                targets.push(...creep.room.find(FIND_MY_CREEPS,{
                        filter: (foundCreep) => {
                            return (foundCreep.memory.role != "harvester" && foundCreep.memory.role != "remoteHarvester" && (foundCreep.carryCapacity - _.sum(foundCreep.carry)) >= creep.carry.energy * .5);
                        }
                }));
            }
            if(targets.length > 0) {
                var best = creep.pos.findClosestByPath(targets);
                if(creep.transfer(best, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(best);
                }
            }
            else{
                creep.memory.role = "none";
            }
        }
	}
};

module.exports = roleHarvester;