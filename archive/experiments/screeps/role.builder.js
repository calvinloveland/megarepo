var findEnergy = require("helper.findEnergy");

var roleBuilder = {

    /** @param {Creep} creep **/
    run: function (creep) {
        if (creep.carry.energy === 0) {
            creep.memory.working = false;
            creep.memory.repairing = false;
        }
        if (creep.carry.energy < creep.carryCapacity && creep.memory.working === false) {
            findEnergy.doIt(creep);
        }
        else {
            creep.memory.working = true;
                var broken = creep.room.find(FIND_MY_STRUCTURES, {
                        filter: (structure) => {
                            return(((structure.hits < structure.hitsMax * .5 && structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL) || structure.hits < 1000) && structure.structureType !== STRUCTURE_CONTROLLER && structure.structureType !== STRUCTURE_EXTRACTOR);
                        }
                    });
                if (broken.length > 0) {
                    var best = creep.pos.findClosestByPath(broken)
                    if (creep.repair(best) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(best);
                        
                    }
                }
                else {

                    var targets = creep.room.find(FIND_CONSTRUCTION_SITES);
                    if (targets.length) {
                        var best = creep.pos.findClosestByPath(targets);
                        var result = creep.build(best);
                        if (result === ERR_NOT_IN_RANGE) {
                            creep.moveTo(best);
                        }
                        else if(result === ERR_RCL_NOT_ENOUGH){
                            creep.memory.role = "upgrader"
                        }
                    }
                    else {
                        creep.memory.role = "upgrader"
                    }
                }
            }
        }
    }

module.exports = roleBuilder;