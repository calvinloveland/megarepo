var findEnergy = {
    
    /** @param {Creep} creep **/
    doIt : function(creep){
        //console.log(creep.room.memory.swapped);
        var sources = creep.room.find(FIND_SOURCES,{filter: (source) => {return source.energy > 0}});
        sources.push(... creep.room.find(FIND_TOMBSTONES,{filter:(tomb)=>{
                return (tomb.store.energy > tomb.ticksToDecay);
            }}));
        var best = creep.pos.findClosestByPath(sources);
        if(creep.pos.getRangeTo(best) === 1){
            //creep.say("MINING");
            creep.harvest(best);
        }
        else{
            var attacking = false;
            if(typeof(creep.room.controller) === "undefined" || 
            typeof(creep.room.controller.owner) === "undefined" ||
            creep.room.controller.owner.username === "Nivlac13"){
                best = creep.pos.findClosestByPath(creep.room.find(FIND_SOURCES, {filter: (source) => {return (source.energyCapacity  === source.energy || source.energy / source.ticksToRegeneration > 5 || creep.memory.role === "remoteHarvester")}}));
            }
            else {
                best = creep.pos.findClosestByPath(creep.room.find(FIND_HOSTILE_STRUCTURES))
            }
            if (best === null && (typeof(creep.room.memory.swapped) === "undefined" || creep.room.memory.swapped < Game.time - 2)){
                creep.say("Buildin");
                    creep.memory.role = "builder";
                    creep.room.memory.swapped = Game.time;
            }
            else if((attacking && creep.dismantle(best) === ERR_NOT_IN_RANGE) || creep.harvest(best) === ERR_NOT_IN_RANGE) {
                if(creep.moveTo(best)== ERR_NO_PATH){
                    creep.say("No room!");
                }
            }
        }
    }
}

module.exports = findEnergy;