
var roleMiner = {

    /** @param {Creep} creep **/
    run: function(creep) {
	    if((_.sum(creep.carry) < creep.carryCapacity && creep.memory.harvesting === true) || _.sum(creep.carry) === 0) {
	        
	        creep.room.memory.mining = false;
	        creep.memory.harvesting = true;
	        var extractor = creep.room.find(FIND_MINERALS);
	        var result = creep.harvest(extractor[0]) 
	        if(result === ERR_NOT_IN_RANGE){
	            creep.moveTo(extractor[0]);
	        }
	        else if (result === ERR_NOT_FOUND){
	            creep.memory.role = "builder";
	        }
        }
        else {
            creep.room.memory.mining = true;
            creep.memory.harvesting = false;
            var targets = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_TERMINAL;
                            
                    }
            });
            for(const resourceType in creep.carry){
                var result = creep.transfer(targets[0], resourceType);
                //console.log(resourceType + result);
                if(result == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0]);
                }
                }
            }
        }

};

module.exports = roleMiner;