package View;

import Control.Game;
import javafx.scene.layout.GridPane;


/**
 * Board -
 *
 * @author: Calvin Loveland
 * @version: 1.0
 */
public class Board extends GridPane {
    final int width = 20;
    final int height = 20;
    final int bombCount = 100;
    Cell[][] Cells = new Cell[width][height];
    Game game;
    Board(Game g){
        setupBoard(g);
    }
    public void setupBoard(Game g){
        game = g;
        g.setBoard(this);
        g.setTotalBombs(bombCount);
        for(int i = 0; i < width; i++){
            for(int j = 0; j<height; j++){
                Cell cell = new Cell(g);
                Cells[i][j] = cell;
                add(cell,i,j);
            }
        }

        for(int i = 0; i < bombCount; i++){
            int randPosX = (int)(Math.random()*width);
            int randPosY = (int)(Math.random()*height);
            if(Cells[randPosX][randPosY].bomb)
                i--;
            else
                Cells[randPosX][randPosY].bomb = true;
        }

        for(int i = 0; i < width; i++){
            for(int j = 0; j<height; j++){
                if(i > 0){
                    Cells[i][j].addNeighbor(Cells[i-1][j]);
                    if(j > 0) {
                        Cells[i][j].addNeighbor(Cells[i-1][j - 1]);
                    }
                    if(j < height-1) {
                        Cells[i][j].addNeighbor(Cells[i-1][j+1]);
                    }
                }
                if(i < width-1){
                    Cells[i][j].addNeighbor(Cells[i+1][j]);
                    if(j > 0) {
                        Cells[i][j].addNeighbor(Cells[i+1][j-1]);
                    }
                    if(j < height-1) {
                        Cells[i][j].addNeighbor(Cells[i+1][j+1]);
                    }
                }
                if(j > 0) {
                    Cells[i][j].addNeighbor(Cells[i][j - 1]);
                }
                if(j < height-1){
                    Cells[i][j].addNeighbor(Cells[i][j+1]);
                }
                Cells[i][j].countBombs();
            }
        }
    }
    public void revealBombs(){
        for(int i = 0; i < width; i++) {
            for (int j = 0; j < height; j++) {
                Cells[i][j].end();
            }
        }
    }
    public void restart(){
        getChildren().clear();
        setupBoard(game);
    }
}
