var findEnergy = {
    
    /** @param {Creep} creep **/
    doIt : function(creep){
        var sources = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return(structure.structureType === STRUCTURE_EXTENSION || structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_LINK) &&
                            structure.energy > 20;
                    }
                });
                
            sources.push(... creep.room.find(FIND_MY_CREEPS,{filter: (found) => {
                return (found.memory.role == "harvester" && creep.memory.harvesting == "false");
            }}));
            sources.push(... creep.room.find(FIND_TOMBSTONES,{filter:(tomb)=>{
                return (tomb.store.energy > tomb.ticksToDecay);
            }}));
            var best = creep.pos.findClosestByPath(sources)
            if (best === null || typeof(best)=== "undefined") {
                creep.say("No Energy!");
                creep.memory.role = "harvester";
            }
            else if(typeof(best.store) !== "undefined"){
                if (creep.withdraw(best, RESOURCE_ENERGY, (best.store.energy<creep.carryCapacity -creep.carry.energy)?best.store.energy:creep.carryCapacity -creep.carry.energy) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(best);
                }
            }
            else if(typeof(best.carry) !== "undefined"){
                if (creep.withdraw(best, RESOURCE_ENERGY, (best.carry.energy<creep.carryCapacity -creep.carry.energy)?best.carry.energy:creep.carryCapacity -creep.carry.energy) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(best);
                }
            }
            else if (typeof(best.energy) !== "undefined"){
                if (creep.withdraw(best, RESOURCE_ENERGY, ((best.energy < creep.carryCapacity -creep.carry.energy)?best.energy:(creep.carryCapacity -creep.carry.energy))) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(best);
                }
            }
            else{
                creep.say("CODE'S BROKE");
            }
}
}

module.exports = findEnergy;