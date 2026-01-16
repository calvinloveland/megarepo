

var roleLink = {

    /** @param {StructureTower} tower **/
    run: function (link) {
        if(link.energyCapacity === link.energy){
                var empty = link.room.find(FIND_STRUCTURES, {
                        filter: (structure) => {
                            return( structure.structureType === STRUCTURE_LINK && structure.energy < structure.energyCapacity / 2);
                        }
                    });
                if (empty.length > 0) {
                    link.transferEnergy(empty[0],empty[0].energyCapacity - empty[0].energy);
                }
            }
    }
            }


module.exports = roleLink;