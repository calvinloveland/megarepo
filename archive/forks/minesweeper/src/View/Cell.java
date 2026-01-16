package View;

import Control.Game;
import javafx.event.ActionEvent;
import javafx.scene.control.Button;
import javafx.scene.control.ButtonType;
import javafx.scene.input.MouseButton;
import javafx.scene.input.MouseEvent;
import sun.management.snmp.jvmmib.EnumJvmMemPoolType;

import java.util.ArrayList;

/**
 * Cell -
 *
 * @author: Calvin Loveland
 * @version: 1.0
 */


public class Cell extends Button
{
    private enum CellType {FLAG,QUESTION,EMPTY}
    CellType type = CellType.EMPTY;;
    public boolean bomb = false;
    ArrayList<Cell> neighbors = new ArrayList<>();
    int neighborsWithBombs = 0;
    boolean clicked = false;
    Game game;

    Cell(Game g){
        game = g;
        setPrefSize(30,30);
        setOnMouseClicked(this::handleButtonAction);
    }

    void addNeighbor(Cell neighbor){
            neighbors.add(neighbor);
    }
    void countBombs(){
        for (Cell cell:neighbors) {
            if(cell.bomb)
                neighborsWithBombs++;
        }
    }
    public void handleButtonAction(MouseEvent event) {
        game.click();
        if(event.getButton() == MouseButton.PRIMARY && type == CellType.EMPTY){
            clicked = true;
            getStyleClass().clear();
            getStyleClass().add("button");
            if(bomb){
                getStyleClass().add("bomb-button");
                game.lose();
            }
            else if(neighborsWithBombs > 0){
                setText(""+neighborsWithBombs);
                getStyleClass().add("numbered-button");
            }
            else{
                getStyleClass().add("empty-button");
                for (Cell cell:neighbors) {
                    if(!cell.clicked)
                        cell.handleButtonAction(event);
                }
            }
        }
        if(event.getButton() == MouseButton.SECONDARY && !clicked){
            if(type == CellType.EMPTY){
                getStyleClass().add("flag-button");
                type = CellType.FLAG;
                game.markBomb(bomb);
            }
            else if(type == CellType.FLAG){
                getStyleClass().add("question-button");
                type = CellType.QUESTION;
                game.unMarkBomb(bomb);
            }
            else if(type == CellType.QUESTION){
                getStyleClass().clear();
                getStyleClass().add("button");
                type = CellType.EMPTY;
            }

        }
    }
    void end(){
        //System.out.println("ENDING");
        clicked = true;
        if(type == CellType.EMPTY){
            if(bomb)
                getStyleClass().add("bomb-button");
            else if(neighborsWithBombs > 0){
                setText(""+neighborsWithBombs);
                getStyleClass().add("numbered-button");
            }
            else
                getStyleClass().add("empty-button");
        }
        else{
            if(bomb)
                getStyleClass().add("marked-bomb");
            else
                getStyleClass().add("marked-nothing");
        }
    }
}
