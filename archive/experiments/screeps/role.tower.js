

var roleTower = {

    /** @param {StructureTower} tower **/
    run: function (tower) {
        var healthNeeded = Math.pow(25,tower.room.controller.level/2) + 10000;
        //console.log(healthNeeded);
        var hostiles = tower.room.find(FIND_HOSTILE_CREEPS);
            if(hostiles.length > 0) {
                var best = tower.pos.findClosestByRange(hostiles);
                tower.attack(best) === ERR_NOT_IN_RANGE;
            }
            else{
                var broken = tower.room.find(FIND_STRUCTURES, {
                        filter: (structure) => {
                            return((structure.structureType === STRUCTURE_WALL && structure.hits < healthNeeded) ||
                            (structure.structureType === STRUCTURE_RAMPART && structure.hits < healthNeeded) ||
                            (structure.structureType === STRUCTURE_ROAD && structure.hits < 2500)
                            );
                        }
                    });
                if (broken.length > 0) {
                    var best = tower.pos.findClosestByPath(broken)
                    if (tower.repair(best) === ERR_NOT_IN_RANGE) {
                        tower.moveTo(best);
                        
                    }
                }
            }
            }
        }

module.exports = roleTower;